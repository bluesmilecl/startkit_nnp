import pg from 'pg';
import type { ChunkInput, DocumentInput, IndexSpace, Principal, RagStore, SearchHit, SearchInput, StoreCapabilities, StoreDiagnostic, StoredDocument, DiagnosticCheck } from './types.js';

const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const STORE_SCHEMA_VERSION = 1;
const MIN_PGVECTOR = [0, 7, 0];

/** Store DDL, versioned independently of the application (the store may live elsewhere). */
const MIGRATIONS: { version: number; sql: (s: string) => string }[] = [
  {
    version: 1,
    sql: (s) => `
      create table if not exists ${s}.documents (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null,
        collection_id uuid not null,
        source_id uuid,
        external_id text not null,
        title text,
        source_url text,
        media_type text,
        language text,
        content_hash text,
        storage_key text,
        bytes bigint,
        version int not null default 1,
        status text not null default 'pending',
        acl_roles text[] not null default '{}',
        acl_users uuid[] not null default '{}',
        metadata jsonb not null default '{}',
        chunk_count int not null default 0,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        indexed_at timestamptz,
        deleted_at timestamptz,
        unique (collection_id, external_id)
      );
      create index if not exists documents_collection_status_idx on ${s}.documents (collection_id, status);
      create index if not exists documents_source_idx on ${s}.documents (source_id);
      create table if not exists ${s}.index_versions (
        id uuid primary key default gen_random_uuid(),
        collection_id uuid not null,
        profile_id uuid not null,
        dimensions int not null,
        status text not null default 'building',
        stats jsonb not null default '{}',
        created_at timestamptz not null default now(),
        activated_at timestamptz
      );
      create index if not exists index_versions_collection_idx on ${s}.index_versions (collection_id, status);
      create table if not exists ${s}.chunks (
        id uuid primary key default gen_random_uuid(),
        document_id uuid not null references ${s}.documents(id) on delete cascade,
        collection_id uuid not null,
        index_version_id uuid not null references ${s}.index_versions(id) on delete cascade,
        profile_id uuid not null,
        ordinal int not null,
        text text not null,
        heading text,
        page int,
        token_count int,
        ts_config regconfig not null default 'spanish',
        tsv tsvector generated always as (to_tsvector(ts_config, coalesce(heading, '') || ' ' || text)) stored,
        embedding vector,
        metadata jsonb not null default '{}',
        created_at timestamptz not null default now()
      );
      create index if not exists chunks_document_idx on ${s}.chunks (document_id, index_version_id);
      create index if not exists chunks_version_idx on ${s}.chunks (index_version_id);
      create index if not exists chunks_tsv_idx on ${s}.chunks using gin (tsv);`,
  },
];

const OPS: Record<string, { op: string; vector: string; halfvec: string; score: (d: string) => string }> = {
  cosine: { op: '<=>', vector: 'vector_cosine_ops', halfvec: 'halfvec_cosine_ops', score: (d) => `1 - (${d})` },
  l2: { op: '<->', vector: 'vector_l2_ops', halfvec: 'halfvec_l2_ops', score: (d) => `1 / (1 + (${d}))` },
  inner_product: { op: '<#>', vector: 'vector_ip_ops', halfvec: 'halfvec_ip_ops', score: (d) => `-(${d})` },
};

function vectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
}

function castFor(space: { dimensions: number; indexType: string }): string {
  const d = Math.trunc(space.dimensions);
  if (!(d > 0 && d <= 16_000)) throw new Error('invalid dimensions');
  return space.indexType === 'hnsw_halfvec' ? `halfvec(${d})` : `vector(${d})`;
}

function semver(v: string | null): number[] {
  return (v ?? '0').split('.').map((x) => Number.parseInt(x, 10) || 0);
}
const gte = (a: number[], b: number[]) => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};

export interface PgStoreOptions {
  kind: 'internal' | 'postgres';
  schema: string;
  readOnly: boolean;
  /**
   * DDL-capable pool for per-profile vector indexes (index creation requires owning the table).
   * Internal stores run with the least-privilege application role, so the registry passes the
   * migration connection here; when omitted the main pool is used.
   */
  ddl?: () => pg.Pool;
}

type DocRow = {
  id: string;
  collection_id: string;
  source_id: string | null;
  external_id: string;
  title: string | null;
  source_url: string | null;
  media_type: string | null;
  content_hash: string | null;
  storage_key: string | null;
  bytes: string | null;
  version: number;
  status: StoredDocument['status'];
  acl_roles: string[];
  acl_users: string[];
  metadata: Record<string, unknown>;
  chunk_count: number;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  indexed_at: Date | null;
};

const toDoc = (r: DocRow): StoredDocument => ({
  id: r.id,
  collectionId: r.collection_id,
  sourceId: r.source_id,
  externalId: r.external_id,
  title: r.title,
  sourceUrl: r.source_url,
  mediaType: r.media_type,
  contentHash: r.content_hash,
  storageKey: r.storage_key,
  bytes: r.bytes === null ? null : Number(r.bytes),
  version: r.version,
  status: r.status,
  aclRoles: r.acl_roles,
  aclUsers: r.acl_users,
  metadata: r.metadata,
  chunkCount: r.chunk_count,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  indexedAt: r.indexed_at,
});

/**
 * PostgreSQL + pgvector store: one schema with documents, index versions and chunks. Vectors of
 * different profiles share the `embedding` column; each profile gets a partial expression index
 * (`embedding::vector(N)` or `halfvec(N)` above 2000 dimensions), so changing the model never
 * requires altering the table — only a new index version and a reindex.
 */
export class PgVectorStore implements RagStore {
  readonly kind: 'internal' | 'postgres';
  private readonly s: string;

  constructor(
    private readonly pool: pg.Pool,
    private readonly opts: PgStoreOptions,
  ) {
    if (!SCHEMA_RE.test(opts.schema)) throw new Error('invalid schema name');
    this.kind = opts.kind;
    this.s = `"${opts.schema}"`;
  }

  capabilities(): StoreCapabilities {
    const write = !this.opts.readOnly;
    return { search: true, vector: true, fullText: true, hybrid: true, ingest: write, delete: write, reindex: write, acl: true, browse: true };
  }

  private q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }

  /** Read-only health and capability check; never changes the target database. */
  async diagnose(): Promise<StoreDiagnostic> {
    return diagnosePg(this.pool, this.opts.schema, this.capabilities());
  }

  async upsertDocument(doc: DocumentInput) {
    const existing = await this.findDocument(doc.collectionId, doc.externalId);
    if (existing && existing.contentHash === doc.contentHash && existing.status === 'indexed' && !existing.error) {
      // Same content: refresh metadata/ACL only.
      const { rows } = await this.q<DocRow>(
        `update ${this.s}.documents set title = $2, source_url = $3, acl_roles = $4, acl_users = $5, metadata = $6, updated_at = now(), deleted_at = null where id = $1 returning *`,
        [existing.id, doc.title, doc.sourceUrl, doc.aclRoles, doc.aclUsers, doc.metadata],
      );
      return { document: toDoc(rows[0]!), changed: false };
    }
    const { rows } = await this.q<DocRow>(
      `insert into ${this.s}.documents (organization_id, collection_id, source_id, external_id, title, source_url, media_type, language, content_hash, storage_key, bytes, acl_roles, acl_users, metadata, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending')
       on conflict (collection_id, external_id) do update set
         source_id = excluded.source_id, title = excluded.title, source_url = excluded.source_url, media_type = excluded.media_type,
         language = excluded.language, content_hash = excluded.content_hash, storage_key = excluded.storage_key, bytes = excluded.bytes,
         acl_roles = excluded.acl_roles, acl_users = excluded.acl_users, metadata = excluded.metadata,
         version = ${this.s}.documents.version + 1, status = 'pending', error = null, deleted_at = null, updated_at = now()
       returning *`,
      [doc.organizationId, doc.collectionId, doc.sourceId, doc.externalId, doc.title, doc.sourceUrl, doc.mediaType, doc.language, doc.contentHash, doc.storageKey, doc.bytes, doc.aclRoles, doc.aclUsers, doc.metadata],
    );
    return { document: toDoc(rows[0]!), changed: true };
  }

  async setDocumentStatus(id: string, status: StoredDocument['status'], error: string | null = null) {
    await this.q(
      `update ${this.s}.documents set status = $2, error = $3, updated_at = now(),
         indexed_at = case when $2 = 'indexed' then now() else indexed_at end,
         chunk_count = (select count(*) from ${this.s}.chunks c join ${this.s}.index_versions v on v.id = c.index_version_id where c.document_id = $1 and v.status in ('active','building'))
       where id = $1`,
      [id, status, error],
    );
  }

  async createIndexVersion(collectionId: string, space: Omit<IndexSpace, 'indexVersionId'>) {
    const { rows } = await this.q<{ id: string }>(`insert into ${this.s}.index_versions (collection_id, profile_id, dimensions, status) values ($1, $2, $3, 'building') returning id`, [
      collectionId,
      space.profileId,
      space.dimensions,
    ]);
    return rows[0]!.id;
  }

  async ensureProfileIndex(space: Omit<IndexSpace, 'indexVersionId' | 'tsConfig'>) {
    if (space.indexType === 'none') return;
    if (!UUID_RE.test(space.profileId)) throw new Error('invalid profile id');
    const ops = OPS[space.metric]!;
    const cast = castFor(space);
    const name = `chunks_emb_${space.profileId.replace(/-/g, '').slice(0, 20)}`;
    const ddl = `create index if not exists ${name} on ${this.s}.chunks using hnsw ((embedding::${cast}) ${space.indexType === 'hnsw_halfvec' ? ops.halfvec : ops.vector}) where profile_id = '${space.profileId}'`;
    if (!this.opts.ddl) {
      await this.q(ddl);
      return;
    }
    const pool = this.opts.ddl();
    try {
      await pool.query(ddl);
    } finally {
      await pool.end().catch(() => {});
    }
  }

  async replaceChunks(documentId: string, collectionId: string, space: IndexSpace, chunks: ChunkInput[]) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(`delete from ${this.s}.chunks where document_id = $1 and index_version_id = $2`, [documentId, space.indexVersionId]);
      for (let i = 0; i < chunks.length; i += 50) {
        const batch = chunks.slice(i, i + 50);
        const values: unknown[] = [];
        const rows = batch.map((c, j) => {
          const b = j * 11;
          values.push(documentId, collectionId, space.indexVersionId, space.profileId, c.ordinal, c.text, c.heading, c.page, c.tokenCount, space.tsConfig, c.embedding ? vectorLiteral(c.embedding) : null);
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10}::regconfig,$${b + 11}::vector)`;
        });
        await client.query(
          `insert into ${this.s}.chunks (document_id, collection_id, index_version_id, profile_id, ordinal, text, heading, page, token_count, ts_config, embedding) values ${rows.join(',')}`,
          values,
        );
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async activateIndexVersion(collectionId: string, indexVersionId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query<{ id: string }>(
        `update ${this.s}.index_versions set status = 'retired' where collection_id = $1 and status = 'active' and id <> $2 returning id`,
        [collectionId, indexVersionId],
      );
      await client.query(
        `update ${this.s}.index_versions set status = 'active', activated_at = now(),
           stats = jsonb_build_object('chunks', (select count(*) from ${this.s}.chunks where index_version_id = $1)) where id = $1`,
        [indexVersionId],
      );
      await client.query('commit');
      return { retired: rows.map((r) => r.id) };
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteIndexVersion(indexVersionId: string) {
    await this.q(`delete from ${this.s}.index_versions where id = $1`, [indexVersionId]);
  }

  async deleteDocument(id: string) {
    const { rows } = await this.q<{ storage_key: string | null }>(`delete from ${this.s}.documents where id = $1 returning storage_key`, [id]);
    return { storageKey: rows[0]?.storage_key ?? null };
  }

  async deleteCollection(collectionId: string) {
    const { rows } = await this.q<{ storage_key: string | null }>(`delete from ${this.s}.documents where collection_id = $1 returning storage_key`, [collectionId]);
    await this.q(`delete from ${this.s}.index_versions where collection_id = $1`, [collectionId]);
    return { storageKeys: rows.map((r) => r.storage_key).filter((k): k is string => !!k) };
  }

  async listDocuments(q: { collectionId?: string; collectionIds: string[]; status?: string; search?: string; page: number; pageSize: number; principal?: Principal | null }) {
    const where = [`collection_id = any($1::uuid[])`, `deleted_at is null`];
    const values: unknown[] = [q.collectionId ? [q.collectionId] : q.collectionIds];
    if (q.principal) {
      values.push(q.principal.roleKeys, q.principal.userId);
      where.push(`((cardinality(acl_roles) = 0 and cardinality(acl_users) = 0) or acl_roles && $${values.length - 1}::text[] or $${values.length}::uuid = any(acl_users))`);
    }
    if (q.status) {
      values.push(q.status);
      where.push(`status = $${values.length}`);
    }
    if (q.search) {
      values.push(`%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`(title ilike $${values.length} or external_id ilike $${values.length} or source_url ilike $${values.length})`);
    }
    const total = await this.q<{ n: string }>(`select count(*) as n from ${this.s}.documents where ${where.join(' and ')}`, values);
    values.push(q.pageSize, (q.page - 1) * q.pageSize);
    const { rows } = await this.q<DocRow>(`select * from ${this.s}.documents where ${where.join(' and ')} order by updated_at desc limit $${values.length - 1} offset $${values.length}`, values);
    return { items: rows.map(toDoc), total: Number(total.rows[0]?.n ?? 0) };
  }

  async getDocument(id: string) {
    const { rows } = await this.q<DocRow>(`select * from ${this.s}.documents where id = $1`, [id]);
    return rows[0] ? toDoc(rows[0]) : null;
  }

  async findDocument(collectionId: string, externalId: string) {
    const { rows } = await this.q<DocRow>(`select * from ${this.s}.documents where collection_id = $1 and external_id = $2`, [collectionId, externalId]);
    return rows[0] ? toDoc(rows[0]) : null;
  }

  async documentChunks(id: string, indexVersionId: string | null, limit: number) {
    const { rows } = await this.q<{ id: string; ordinal: number; text: string; heading: string | null; page: number | null; token_count: number | null }>(
      `select c.id, c.ordinal, c.text, c.heading, c.page, c.token_count from ${this.s}.chunks c
       where c.document_id = $1 and ($2::uuid is null or c.index_version_id = $2) order by c.ordinal limit $3`,
      [id, indexVersionId, limit],
    );
    return rows.map((r) => ({ id: r.id, ordinal: r.ordinal, text: r.text, heading: r.heading, page: r.page, tokenCount: r.token_count }));
  }

  async collectionStats(collectionIds: string[]) {
    const out: Record<string, { documents: number; indexed: number; failed: number; chunks: number; bytes: number }> = {};
    if (!collectionIds.length) return out;
    const { rows } = await this.q<{ collection_id: string; documents: string; indexed: string; failed: string; chunks: string; bytes: string }>(
      `select d.collection_id, count(*) as documents, count(*) filter (where status = 'indexed') as indexed, count(*) filter (where status = 'failed') as failed,
         coalesce(sum(chunk_count), 0) as chunks, coalesce(sum(bytes), 0) as bytes
       from ${this.s}.documents d where d.collection_id = any($1::uuid[]) and deleted_at is null group by d.collection_id`,
      [collectionIds],
    );
    for (const r of rows) out[r.collection_id] = { documents: Number(r.documents), indexed: Number(r.indexed), failed: Number(r.failed), chunks: Number(r.chunks), bytes: Number(r.bytes) };
    return out;
  }

  /**
   * Hybrid retrieval: vector KNN per index space (partial HNSW index, iterative scan so that
   * filters do not starve results) + full text (any-term tsquery), fused with Reciprocal
   * Rank Fusion. Document ACLs are applied inside the queries, never after.
   */
  async search(input: SearchInput): Promise<SearchHit[]> {
    const candidates = Math.max(input.topK * 4, 20);
    const acl = `((cardinality(d.acl_roles) = 0 and cardinality(d.acl_users) = 0) or d.acl_roles && $2::text[] or $3::uuid = any(d.acl_users))`;
    const docFilter = [
      `d.status = 'indexed'`,
      `d.deleted_at is null`,
      acl,
      input.filters?.documentIds?.length ? `d.id = any($4::uuid[])` : `$4::uuid[] is null`,
      input.filters?.sourceIds?.length ? `d.source_id = any($5::uuid[])` : `$5::uuid[] is null`,
    ].join(' and ');
    const base = [input.principal.roleKeys, input.principal.userId, input.filters?.documentIds?.length ? input.filters.documentIds : null, input.filters?.sourceIds?.length ? input.filters.sourceIds : null];
    const select = `c.id, c.document_id, c.collection_id, c.text, c.heading, c.page, d.title, d.source_url`;
    type Row = { id: string; document_id: string; collection_id: string; text: string; heading: string | null; page: number | null; title: string | null; source_url: string | null; score: number };

    const vectorHits: Row[] = [];
    if (input.method !== 'fulltext' && input.queryEmbedding) {
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        await client.query(`set local hnsw.ef_search = 100`).catch(() => {});
        await client.query(`set local hnsw.iterative_scan = 'relaxed_order'`).catch(() => {});
        for (const space of input.spaces) {
          if (!UUID_RE.test(space.profileId) || !UUID_RE.test(space.indexVersionId)) continue;
          const ops = OPS[space.metric]!;
          const cast = castFor(space);
          const dist = `c.embedding::${cast} ${ops.op} $1::${cast}`;
          const { rows } = await client.query<Row>(
            `select ${select}, ${ops.score(dist)} as score from ${this.s}.chunks c join ${this.s}.documents d on d.id = c.document_id
             where c.profile_id = '${space.profileId}' and c.index_version_id = '${space.indexVersionId}' and c.embedding is not null and ${docFilter}
             order by ${dist} limit ${candidates}`,
            [vectorLiteral(input.queryEmbedding), ...base],
          );
          vectorHits.push(...rows);
        }
        await client.query('commit');
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      vectorHits.sort((a, b) => b.score - a.score);
    }

    const textHits: Row[] = [];
    if (input.method !== 'vector' && input.query.trim()) {
      const configs = [...new Set(input.spaces.map((s) => s.tsConfig))];
      for (const cfg of configs) {
        const vs = input.spaces.filter((s) => s.tsConfig === cfg).map((s) => s.indexVersionId);
        const { rows } = await this.q<Row>(
          `select ${select}, ts_rank_cd(c.tsv, query) as score
           from ${this.s}.chunks c join ${this.s}.documents d on d.id = c.document_id,
             -- Natural-language questions: any term may match (OR); ts_rank_cd rewards matching more terms.
             to_tsquery($6::regconfig, nullif(replace(plainto_tsquery($6::regconfig, $1)::text, ' & ', ' | '), '')) query
           where c.index_version_id = any($7::uuid[]) and c.tsv @@ query and ${docFilter}
           order by score desc limit ${candidates}`,
          [input.query, ...base, cfg, vs],
        );
        textHits.push(...rows);
      }
      textHits.sort((a, b) => b.score - a.score);
    }

    const toHit = (r: Row, score: number, scoreType: SearchHit['scoreType'], vr: number | null, tr: number | null): SearchHit => ({
      chunkId: r.id,
      documentId: r.document_id,
      collectionId: r.collection_id,
      text: r.text,
      heading: r.heading,
      page: r.page,
      title: r.title,
      sourceUrl: r.source_url,
      score,
      scoreType,
      vectorRank: vr,
      textRank: tr,
    });

    const metrics = new Set(input.spaces.map((sp) => sp.metric));
    const vectorType: SearchHit['scoreType'] = metrics.size !== 1 ? 'vector_similarity' : ({ cosine: 'cosine_similarity', l2: 'l2_similarity', inner_product: 'inner_product' } as const)[[...metrics][0] as 'cosine'] ?? 'vector_similarity';
    if (input.method === 'vector') return vectorHits.filter((r) => r.score >= input.minScore).slice(0, input.topK).map((r, i) => toHit(r, r.score, vectorType, i + 1, null));
    if (input.method === 'fulltext') return textHits.slice(0, input.topK).map((r, i) => toHit(r, r.score, 'ts_rank', null, i + 1));

    // Reciprocal Rank Fusion (k = 60). minScore applies to the vector similarity when present.
    const fused = new Map<string, { row: Row; score: number; vr: number | null; tr: number | null; sim: number | null }>();
    vectorHits.forEach((r, i) => fused.set(r.id, { row: r, score: 1 / (60 + i + 1), vr: i + 1, tr: null, sim: r.score }));
    textHits.forEach((r, i) => {
      const e = fused.get(r.id);
      if (e) {
        e.score += 1 / (60 + i + 1);
        e.tr = i + 1;
      } else fused.set(r.id, { row: r, score: 1 / (60 + i + 1), vr: null, tr: i + 1, sim: null });
    });
    return [...fused.values()]
      .filter((e) => e.sim === null || e.sim >= input.minScore || e.tr !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.topK)
      .map((e) => toHit(e.row, e.score, 'rrf', e.vr, e.tr));
  }

  async close() {
    await this.pool.end();
  }
}

/** Shared read-only diagnostic for any PostgreSQL target. */
export async function diagnosePg(pool: pg.Pool, schema: string, caps: StoreCapabilities): Promise<StoreDiagnostic> {
  const t0 = Date.now();
  const checks: DiagnosticCheck[] = [];
  const manualSteps: string[] = [];
  const push = (key: string, label: string, status: DiagnosticCheck['status'], detail: string | null = null) => checks.push({ key, label, status, detail });
  try {
    const { rows: info } = await pool.query<{ version: string; usr: string; db: string; superuser: boolean; can_create: boolean }>(
      `select current_setting('server_version') as version, current_user as usr, current_database() as db,
         (select rolsuper from pg_roles where rolname = current_user) as superuser,
         has_database_privilege(current_user, current_database(), 'CREATE') as can_create`,
    );
    const i = info[0]!;
    push('connection', 'Conexión', 'ok', `PostgreSQL ${i.version} · usuario ${i.usr} · base ${i.db}`);
    const { rows: ext } = await pool.query<{ default_version: string | null; installed_version: string | null }>(
      `select default_version, installed_version from pg_available_extensions where name = 'vector'`,
    );
    const e = ext[0];
    if (!e) {
      push('pgvector', 'Extensión pgvector', 'error', 'No está disponible en el servidor');
      manualSteps.push('Instala pgvector en el servidor PostgreSQL (por ejemplo la imagen pgvector/pgvector) y vuelve a diagnosticar.');
    } else if (!e.installed_version) {
      push('pgvector', 'Extensión pgvector', 'warn', `Disponible ${e.default_version}, no instalada en esta base`);
      if (!i.superuser) manualSteps.push(`Como superusuario, en la base ${i.db}: CREATE EXTENSION IF NOT EXISTS vector;`);
    } else if (!gte(semver(e.installed_version), MIN_PGVECTOR)) {
      push('pgvector', 'Extensión pgvector', 'error', `Instalada ${e.installed_version}; se requiere 0.7 o superior (halfvec)`);
      manualSteps.push('ALTER EXTENSION vector UPDATE;');
    } else {
      push('pgvector', 'Extensión pgvector', 'ok', `Instalada ${e.installed_version}${gte(semver(e.installed_version), [0, 8, 0]) ? ' (búsqueda iterativa disponible)' : ''}`);
    }
    const { rows: sch } = await pool.query<{ exists: boolean }>(`select exists (select 1 from pg_namespace where nspname = $1) as exists`, [schema]);
    if (!sch[0]?.exists) {
      push('schema', `Esquema ${schema}`, 'warn', 'Aún no existe; se crea al activar');
      if (!i.can_create && !i.superuser) manualSteps.push(`GRANT CREATE ON DATABASE "${i.db}" TO "${i.usr}"; (o crea el esquema ${schema} como propietario)`);
    } else {
      const { rows: mv } = await pool.query<{ v: number | null }>(`select max(version) as v from "${schema}".store_migrations`).catch(() => ({ rows: [{ v: null }] }));
      const v = mv[0]?.v ?? 0;
      push('schema', `Esquema ${schema}`, v >= STORE_SCHEMA_VERSION ? 'ok' : 'warn', v >= STORE_SCHEMA_VERSION ? `Versión ${v}` : `Versión ${v}; requiere ${STORE_SCHEMA_VERSION} (activa para migrar)`);
      if (v >= 1) {
        const { rows: priv } = await pool.query<{ ins: boolean; sel: boolean }>(
          `select has_table_privilege(current_user, $1, 'INSERT') as ins, has_table_privilege(current_user, $1, 'SELECT') as sel`,
          [`"${schema}".chunks`],
        );
        const p = priv[0]!;
        push('privileges', 'Privilegios de la aplicación', p.sel && (p.ins || !caps.ingest) ? 'ok' : 'error', `lectura ${p.sel ? 'sí' : 'no'} · escritura ${p.ins ? 'sí' : 'no'}`);
        const { rows: counts } = await pool.query<{ docs: string; chunks: string }>(`select (select count(*) from "${schema}".documents) as docs, (select count(*) from "${schema}".chunks) as chunks`);
        push('content', 'Contenido', 'ok', `${counts[0]!.docs} documentos · ${counts[0]!.chunks} fragmentos`);
      }
    }
  } catch (err) {
    push('connection', 'Conexión', 'error', (err as Error).message.slice(0, 300));
  }
  return { ok: !checks.some((c) => c.status === 'error') && checks.every((c) => c.key !== 'pgvector' || c.status === 'ok') && checks.some((c) => c.key === 'schema' && c.status === 'ok'), checks, manualSteps, capabilities: caps, latencyMs: Date.now() - t0 };
}

/**
 * Creates the extension (when allowed), the schema and pending store migrations using a
 * DDL-capable connection, then grants DML to the runtime role. Idempotent, serialized with an
 * advisory lock.
 */
export async function migratePgStore(ddl: pg.Pool, schema: string, opts: { createExtension: boolean; grantTo?: string | null }): Promise<{ applied: number[] }> {
  if (!SCHEMA_RE.test(schema)) throw new Error('invalid schema name');
  const client = await ddl.connect();
  const applied: number[] = [];
  try {
    await client.query('select pg_advisory_lock(727010)');
    if (opts.createExtension) await client.query('create extension if not exists vector');
    await client.query(`create schema if not exists "${schema}"`);
    await client.query(`create table if not exists "${schema}".store_migrations (version int primary key, applied_at timestamptz not null default now())`);
    const { rows } = await client.query<{ version: number }>(`select version from "${schema}".store_migrations`);
    const done = new Set(rows.map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      await client.query('begin');
      await client.query(m.sql(`"${schema}"`));
      await client.query(`insert into "${schema}".store_migrations (version) values ($1)`, [m.version]);
      await client.query('commit');
      applied.push(m.version);
    }
    if (opts.grantTo) {
      const role = `"${opts.grantTo.replace(/"/g, '""')}"`;
      await client.query(`grant usage on schema "${schema}" to ${role}`);
      await client.query(`grant select, insert, update, delete on all tables in schema "${schema}" to ${role}`);
      await client.query(`alter default privileges in schema "${schema}" grant select, insert, update, delete on tables to ${role}`);
    }
    return { applied };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.query('select pg_advisory_unlock(727010)').catch(() => {});
    client.release();
  }
}

export function createPgPool(connectionString: string, opts: { ssl?: 'disable' | 'require' | 'verify-full'; max?: number; timeoutMs?: number; applicationName?: string } = {}): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: opts.max ?? 5,
    ssl: opts.ssl === 'require' ? { rejectUnauthorized: false } : opts.ssl === 'verify-full' ? { rejectUnauthorized: true } : undefined,
    connectionTimeoutMillis: opts.timeoutMs ?? 10_000,
    statement_timeout: opts.timeoutMs ? Math.max(opts.timeoutMs, 5000) : 30_000,
    application_name: opts.applicationName ?? 'starter-rag',
  });
}
