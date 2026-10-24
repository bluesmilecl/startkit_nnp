import { assertCan, recordAudit, type Actor } from '@starter/auth';
import { AppError, type Collection, type CreateCollectionInput, type CreateSourceInput } from '@starter/contracts';
import { and, count, eq, embeddingProfiles, ilike, inArray, ragCollections, ragConnections, ragSources, sql, type SQL } from '@starter/db';
import { newKey } from '@starter/storage';
import { CronExpressionParser } from 'cron-parser';
import { createHash } from 'node:crypto';
import { validateUpload } from '@starter/ai';
import type { StoredDocument } from '../store/types.js';
import type { RagConnectionsService } from './connections.js';
import type { RagDeps, StoreRegistry } from './context.js';
import type { RagJobsService } from './jobs.js';

type CollectionRow = typeof ragCollections.$inferSelect;
type SourceRow = typeof ragSources.$inferSelect;

const LANGS = new Set(['spanish', 'english', 'portuguese', 'simple']);

export function nextRun(cron: string, from = new Date()): Date {
  try {
    return CronExpressionParser.parse(cron, { currentDate: from, tz: 'UTC' }).next().toDate();
  } catch {
    throw AppError.validation('Expresión cron inválida (5 campos, UTC)');
  }
}

/**
 * Collection-level access: organization collections need rag.documents.read; restricted ones
 * also need a matching role or user. Managers see every collection in administration views,
 * but retrieval for chat always applies the reader rules.
 */
export function canReadCollection(actor: Actor, c: Pick<CollectionRow, 'visibility' | 'aclRoles' | 'aclUsers'>, management = false): boolean {
  if (management && actor.permissions.has('rag.collections.manage')) return true;
  if (!actor.permissions.has('rag.documents.read')) return false;
  if (c.visibility === 'organization') return true;
  const keys = roleKeys(actor);
  return c.aclUsers.includes(actor.userId) || c.aclRoles.some((r) => keys.includes(r));
}

export const roleKeys = (actor: Actor) => [...new Set(actor.roles.map((r) => r.key))];

/** Collection visibility in management views: restricted collections only for their roles/users. */
export function canSeeCollection(actor: Actor, c: Pick<CollectionRow, 'visibility' | 'aclRoles' | 'aclUsers'>): boolean {
  if (actor.permissions.has('rag.collections.manage')) return true;
  if (!actor.permissions.has('rag.collections.read') && !actor.permissions.has('rag.documents.read')) return false;
  if (c.visibility === 'organization') return true;
  const keys = roleKeys(actor);
  return c.aclUsers.includes(actor.userId) || c.aclRoles.some((r) => keys.includes(r));
}

/** Document ACL for browsing; knowledge managers see every document of the collections they manage. */
export function canReadDocument(actor: Actor, d: Pick<StoredDocument, 'aclRoles' | 'aclUsers'>): boolean {
  if (actor.permissions.has('rag.collections.manage')) return true;
  if (!d.aclRoles.length && !d.aclUsers.length) return true;
  const keys = roleKeys(actor);
  return d.aclUsers.includes(actor.userId) || d.aclRoles.some((r) => keys.includes(r));
}

export class CollectionsService {
  constructor(
    private readonly deps: RagDeps,
    private readonly stores: StoreRegistry,
    private readonly connections: RagConnectionsService,
    private readonly jobs: RagJobsService,
  ) {}

  private async toDtos(rows: { c: CollectionRow; conn: typeof ragConnections.$inferSelect; p: typeof embeddingProfiles.$inferSelect | null }[]): Promise<Collection[]> {
    const ids = rows.map((r) => r.c.id);
    const sources = ids.length ? await this.deps.db.select({ id: ragSources.collectionId, n: count() }).from(ragSources).where(inArray(ragSources.collectionId, ids)).groupBy(ragSources.collectionId) : [];
    const stats: Record<string, Collection['stats']> = {};
    const byConn = new Map<string, { conn: typeof ragConnections.$inferSelect; ids: string[] }>();
    for (const r of rows) byConn.set(r.conn.id, { conn: r.conn, ids: [...(byConn.get(r.conn.id)?.ids ?? []), r.c.id] });
    for (const { conn, ids: cids } of byConn.values()) {
      try {
        const store = this.stores.get(conn);
        if (store.capabilities().browse) Object.assign(stats, await store.collectionStats(cids));
      } catch {
        /* store unavailable: stats stay empty, the diagnostic explains why */
      }
    }
    return rows.map(({ c, conn, p }) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      language: c.language,
      connection: { id: conn.id, name: conn.name, kind: conn.kind as Collection['connection']['kind'], status: conn.status },
      profile: p ? { id: p.id, name: p.name, modelId: p.modelId, dimensions: p.dimensions } : null,
      chunking: { size: 1200, overlap: 150, ...(c.chunking as object) } as Collection['chunking'],
      retrieval: { method: 'hybrid', topK: 6, minScore: 0, ...(c.retrieval as object) } as Collection['retrieval'],
      visibility: c.visibility,
      aclRoles: c.aclRoles,
      aclUsers: c.aclUsers,
      retentionDays: c.retentionDays,
      externalRef: c.externalRef,
      status: c.status,
      activeIndexVersionId: c.activeIndexVersionId,
      buildingIndexVersionId: c.buildingIndexVersionId,
      stats: stats[c.id] ?? { documents: 0, indexed: 0, failed: 0, chunks: 0, bytes: 0 },
      sources: sources.find((s) => s.id === c.id)?.n ?? 0,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  private baseQuery(where: SQL | undefined) {
    return this.deps.db
      .select({ c: ragCollections, conn: ragConnections, p: embeddingProfiles })
      .from(ragCollections)
      .innerJoin(ragConnections, eq(ragConnections.id, ragCollections.ragConnectionId))
      .leftJoin(embeddingProfiles, eq(embeddingProfiles.id, ragCollections.embeddingProfileId))
      .where(where)
      .orderBy(ragCollections.name);
  }

  async list(actor: Actor, q: { page?: number; pageSize?: number; search?: string }) {
    if (!actor.permissions.has('rag.collections.manage')) assertCan(actor, 'rag.collections.read');
    const rows = await this.baseQuery(and(eq(ragCollections.organizationId, actor.organizationId), q.search ? ilike(ragCollections.name, `%${q.search}%`) : undefined));
    const visible = rows.filter((r) => canSeeCollection(actor, r.c));
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, q.pageSize ?? 20);
    const items = await this.toDtos(visible.slice((page - 1) * pageSize, page * pageSize));
    return { items, page, pageSize, total: visible.length, pageCount: Math.max(1, Math.ceil(visible.length / pageSize)) };
  }

  async findRow(organizationId: string, id: string) {
    const [r] = await this.baseQuery(and(eq(ragCollections.id, id), eq(ragCollections.organizationId, organizationId)));
    if (!r) throw AppError.notFound('Colección');
    return r;
  }

  async get(actor: Actor, id: string) {
    if (!actor.permissions.has('rag.collections.manage')) assertCan(actor, 'rag.collections.read');
    const r = await this.findRow(actor.organizationId, id);
    if (!canSeeCollection(actor, r.c)) throw AppError.notFound('Colección');
    return (await this.toDtos([r]))[0]!;
  }

  async create(actor: Actor, input: CreateCollectionInput) {
    assertCan(actor, 'rag.collections.manage');
    const conn = await this.connections.findRow(actor.organizationId, input.ragConnectionId);
    if (conn.status !== 'ready') throw new AppError('NOT_CONFIGURED', 'La conexión de conocimiento no está lista: diagnostícala y actívala primero');
    if (!LANGS.has(input.language)) throw AppError.validation('Idioma no soportado');
    let profile: typeof embeddingProfiles.$inferSelect | null = null;
    if (conn.kind !== 'api') {
      if (!input.embeddingProfileId) throw AppError.validation('Las colecciones en PostgreSQL requieren un perfil de embeddings');
      const [found] = await this.deps.db.select().from(embeddingProfiles).where(and(eq(embeddingProfiles.id, input.embeddingProfileId), eq(embeddingProfiles.organizationId, actor.organizationId)));
      if (!found) throw AppError.notFound('Perfil de embeddings');
      profile = found;
    }
    const [dup] = await this.deps.db.select({ id: ragCollections.id }).from(ragCollections).where(and(eq(ragCollections.organizationId, actor.organizationId), eq(ragCollections.slug, input.slug)));
    if (dup) throw AppError.conflict('Ya existe una colección con ese identificador');
    const [c] = await this.deps.db
      .insert(ragCollections)
      .values({
        organizationId: actor.organizationId,
        ragConnectionId: conn.id,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        language: input.language,
        embeddingProfileId: profile?.id ?? null,
        chunking: input.chunking,
        retrieval: input.retrieval,
        visibility: input.visibility,
        aclRoles: input.aclRoles,
        aclUsers: input.aclUsers,
        retentionDays: input.retentionDays ?? null,
        externalRef: input.externalRef ?? null,
        createdBy: actor.userId,
      })
      .returning();
    if (profile) {
      // Empty active index version so documents can be added right away.
      const store = this.stores.get(conn);
      await store.ensureProfileIndex({ profileId: profile.id, dimensions: profile.dimensions, metric: profile.metric, indexType: profile.indexType });
      const versionId = await store.createIndexVersion(c!.id, { profileId: profile.id, dimensions: profile.dimensions, metric: profile.metric, indexType: profile.indexType, tsConfig: input.language });
      await store.activateIndexVersion(c!.id, versionId);
      await this.deps.db.update(ragCollections).set({ activeIndexVersionId: versionId }).where(eq(ragCollections.id, c!.id));
    }
    if (conn.kind === 'api' && input.externalRef) {
      const cfg = conn.config as { externalRefs?: Record<string, string> };
      await this.deps.db.update(ragConnections).set({ config: { ...conn.config, externalRefs: { ...(cfg.externalRefs ?? {}), [c!.id]: input.externalRef } } }).where(eq(ragConnections.id, conn.id));
    }
    await recordAudit(this.deps.db, actor, { action: 'rag.collections.create', resourceType: 'rag_collection', resourceId: c!.id, outcome: 'success', after: { name: input.name, connection: conn.name, visibility: input.visibility } });
    return this.get(actor, c!.id);
  }

  async update(actor: Actor, id: string, input: Partial<CreateCollectionInput> & { status?: 'active' | 'paused' }) {
    assertCan(actor, 'rag.collections.manage');
    const { c } = await this.findRow(actor.organizationId, id);
    if (input.embeddingProfileId && input.embeddingProfileId !== c.embeddingProfileId) {
      throw AppError.validation('Cambiar el perfil de embeddings requiere reindexar: usa «Reindexar con otro perfil»');
    }
    const aclChanged = (input.visibility && input.visibility !== c.visibility) || input.aclRoles !== undefined || input.aclUsers !== undefined;
    await this.deps.db
      .update(ragCollections)
      .set({
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(input.chunking ? { chunking: input.chunking } : {}),
        ...(input.retrieval ? { retrieval: input.retrieval } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
        ...(input.aclRoles ? { aclRoles: input.aclRoles } : {}),
        ...(input.aclUsers ? { aclUsers: input.aclUsers } : {}),
        ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(aclChanged ? { cacheEpoch: sql`${ragCollections.cacheEpoch} + 1` } : {}),
      })
      .where(eq(ragCollections.id, id));
    await recordAudit(this.deps.db, actor, { action: 'rag.collections.update', resourceType: 'rag_collection', resourceId: id, outcome: 'success', before: { visibility: c.visibility, aclRoles: c.aclRoles, aclUsers: c.aclUsers }, after: input });
    return this.get(actor, id);
  }

  /** Durable purge: documents, chunks, vectors and stored files, then the collection itself. */
  async remove(actor: Actor, id: string) {
    assertCan(actor, 'rag.collections.manage');
    const { c } = await this.findRow(actor.organizationId, id);
    if (c.status === 'deleting') throw AppError.conflict('La colección ya se está eliminando');
    await this.deps.db.update(ragCollections).set({ status: 'deleting' }).where(eq(ragCollections.id, id));
    const job = await this.jobs.enqueue({ organizationId: actor.organizationId, kind: 'purge-collection', collectionId: id, createdBy: actor.userId, idempotencyKey: `purge:${id}` });
    await recordAudit(this.deps.db, actor, { action: 'rag.collections.delete', resourceType: 'rag_collection', resourceId: id, outcome: 'success', metadata: { jobId: job.id, name: c.name } });
    return { jobId: job.id, status: 'queued' };
  }

  /** Builds a new index version (model change or rebuild) without interrupting searches. */
  async reindex(actor: Actor, id: string, input: { embeddingProfileId?: string; budgetUsd?: string }) {
    assertCan(actor, 'rag.collections.manage');
    const { c, conn } = await this.findRow(actor.organizationId, id);
    if (conn.kind === 'api') throw new AppError('CAPABILITY_UNSUPPORTED', 'Las colecciones de una API externa se reindexan en el propio servicio');
    if (c.buildingIndexVersionId) throw AppError.conflict('Ya hay una reindexación en curso');
    const profileId = input.embeddingProfileId ?? c.embeddingProfileId;
    if (!profileId) throw AppError.validation('La colección no tiene perfil de embeddings');
    const [p] = await this.deps.db.select().from(embeddingProfiles).where(and(eq(embeddingProfiles.id, profileId), eq(embeddingProfiles.organizationId, actor.organizationId)));
    if (!p) throw AppError.notFound('Perfil de embeddings');
    const job = await this.jobs.enqueue({ organizationId: actor.organizationId, kind: 'reindex', collectionId: id, params: { profileId }, createdBy: actor.userId, idempotencyKey: `reindex:${id}`, budgetUsd: input.budgetUsd ?? null });
    await recordAudit(this.deps.db, actor, { action: 'rag.collections.reindex', resourceType: 'rag_collection', resourceId: id, outcome: 'success', metadata: { profile: p.name, model: p.modelId, jobId: job.id } });
    return { jobId: job.id, status: 'queued' };
  }

  /** Collections the actor may read (retrieval and document views). */
  async readable(actor: Actor, ids: string[] | null, management = false) {
    const rows = await this.baseQuery(and(eq(ragCollections.organizationId, actor.organizationId), ids ? inArray(ragCollections.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : undefined, eq(ragCollections.status, 'active')));
    return rows.filter((r) => canReadCollection(actor, r.c, management));
  }
}

export class SourcesService {
  constructor(
    private readonly deps: RagDeps,
    private readonly stores: StoreRegistry,
    private readonly collections: CollectionsService,
    private readonly jobs: RagJobsService,
  ) {}

  static toDto(s: SourceRow) {
    return {
      id: s.id,
      collectionId: s.collectionId,
      kind: s.kind as 'upload' | 'url' | 'sitemap' | 'text',
      name: s.name,
      config: s.kind === 'text' ? { ...s.config, text: undefined } : s.config,
      schedule: s.schedule,
      status: s.status,
      lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
      nextSyncAt: s.nextSyncAt?.toISOString() ?? null,
      lastError: s.lastError,
      stats: s.stats,
      createdAt: s.createdAt.toISOString(),
    };
  }

  async list(actor: Actor, collectionId: string) {
    if (!actor.permissions.has('rag.sources.manage')) assertCan(actor, 'rag.collections.read');
    await this.collections.findRow(actor.organizationId, collectionId);
    const rows = await this.deps.db.select().from(ragSources).where(eq(ragSources.collectionId, collectionId)).orderBy(ragSources.createdAt);
    return rows.map(SourcesService.toDto);
  }

  private async findRow(actor: Actor, id: string) {
    const [s] = await this.deps.db.select().from(ragSources).where(and(eq(ragSources.id, id), eq(ragSources.organizationId, actor.organizationId)));
    if (!s) throw AppError.notFound('Fuente');
    return s;
  }

  private async writableCollection(actor: Actor, collectionId: string) {
    const r = await this.collections.findRow(actor.organizationId, collectionId);
    if (r.c.status !== 'active') throw AppError.conflict('La colección no está activa');
    const caps = this.stores.get(r.conn).capabilities();
    if (!caps.ingest) throw new AppError('CAPABILITY_UNSUPPORTED', 'La conexión de esta colección no admite ingesta desde el starter (solo lectura)');
    return r;
  }

  async create(actor: Actor, collectionId: string, input: CreateSourceInput) {
    assertCan(actor, 'rag.sources.manage');
    await this.writableCollection(actor, collectionId);
    let config: Record<string, unknown> = { acl: input.acl };
    let schedule: string | null = null;
    if (input.kind === 'url') {
      config = { ...config, url: input.url };
      schedule = input.schedule ?? null;
    } else if (input.kind === 'sitemap') {
      if (input.include) new RegExp(input.include);
      if (input.exclude) new RegExp(input.exclude);
      config = { ...config, url: input.url, maxUrls: input.maxUrls, include: input.include ?? null, exclude: input.exclude ?? null };
      schedule = input.schedule ?? null;
    } else if (input.kind === 'text') {
      // The text is stored as a Markdown file so reindexing never depends on the request.
      const key = newKey(`rag/${actor.organizationId}`, '.md');
      await this.deps.storage.put(key, Buffer.from(input.text, 'utf8'), 'text/markdown');
      config = { ...config, title: input.title, storageKey: key, bytes: Buffer.byteLength(input.text) };
    }
    const [s] = await this.deps.db
      .insert(ragSources)
      .values({ organizationId: actor.organizationId, collectionId, kind: input.kind, name: input.name, config, schedule, nextSyncAt: schedule ? nextRun(schedule) : null, createdBy: actor.userId })
      .returning();
    await recordAudit(this.deps.db, actor, { action: 'rag.sources.create', resourceType: 'rag_source', resourceId: s!.id, outcome: 'success', after: { kind: input.kind, name: input.name, url: (config.url as string) ?? null } });
    if (input.kind !== 'upload') await this.sync(actor, s!.id);
    return SourcesService.toDto((await this.findRow(actor, s!.id))!);
  }

  async update(actor: Actor, id: string, input: { name?: string; schedule?: string | null; status?: 'active' | 'paused' }) {
    assertCan(actor, 'rag.sources.manage');
    const s = await this.findRow(actor, id);
    const schedule = input.schedule === undefined ? s.schedule : input.schedule;
    await this.deps.db
      .update(ragSources)
      .set({ ...(input.name ? { name: input.name } : {}), ...(input.status ? { status: input.status } : {}), schedule, nextSyncAt: schedule ? nextRun(schedule) : null })
      .where(eq(ragSources.id, id));
    await recordAudit(this.deps.db, actor, { action: 'rag.sources.update', resourceType: 'rag_source', resourceId: id, outcome: 'success', after: input });
    return SourcesService.toDto(await this.findRow(actor, id));
  }

  async remove(actor: Actor, id: string) {
    assertCan(actor, 'rag.sources.manage');
    const s = await this.findRow(actor, id);
    const { conn } = await this.collections.findRow(actor.organizationId, s.collectionId);
    const store = this.stores.get(conn);
    // Documents of the source are deleted through durable jobs (vectors + files).
    if (store.capabilities().browse) {
      const docs = await store.listDocuments({ collectionIds: [s.collectionId], page: 1, pageSize: 10_000 });
      for (const d of docs.items.filter((x) => x.sourceId === id)) {
        await this.jobs.enqueue({ organizationId: actor.organizationId, kind: 'delete-document', collectionId: s.collectionId, documentId: d.id, createdBy: actor.userId, idempotencyKey: `delete:${d.id}` });
      }
    }
    await this.deps.db.update(ragSources).set({ status: 'deleting' }).where(eq(ragSources.id, id));
    await this.deps.db.delete(ragSources).where(eq(ragSources.id, id));
    if (s.kind === 'text' && s.config.storageKey) await this.deps.storage.delete(String(s.config.storageKey)).catch(() => {});
    await recordAudit(this.deps.db, actor, { action: 'rag.sources.delete', resourceType: 'rag_source', resourceId: id, outcome: 'success', metadata: { name: s.name } });
  }

  async sync(actor: Actor, id: string) {
    assertCan(actor, 'rag.sources.manage');
    const s = await this.findRow(actor, id);
    if (s.kind === 'upload') throw AppError.validation('Las fuentes de archivos se actualizan subiendo documentos');
    const job = await this.jobs.enqueue({ organizationId: actor.organizationId, kind: 'ingest-source', collectionId: s.collectionId, sourceId: id, createdBy: actor.userId, idempotencyKey: `sync:${id}` });
    return { jobId: job.id, status: 'queued' };
  }

  /** Upload source of a collection (created on first upload). */
  private async uploadSource(actor: Actor, collectionId: string): Promise<SourceRow> {
    const [existing] = await this.deps.db.select().from(ragSources).where(and(eq(ragSources.collectionId, collectionId), eq(ragSources.kind, 'upload'))).limit(1);
    if (existing) return existing;
    const [s] = await this.deps.db.insert(ragSources).values({ organizationId: actor.organizationId, collectionId, kind: 'upload', name: 'Archivos subidos', config: { acl: { roles: [], users: [] } }, createdBy: actor.userId }).returning();
    return s!;
  }

  /** Uploads a file into a collection: validated by content, stored, then indexed by a job. */
  async upload(actor: Actor, collectionId: string, file: { buffer: Buffer; originalname: string; mimetype: string }, acl: { roles: string[]; users: string[] } = { roles: [], users: [] }) {
    assertCan(actor, 'rag.sources.manage');
    await this.writableCollection(actor, collectionId);
    if (file.buffer.length > this.deps.env.RAG_FETCH_MAX_BYTES) throw AppError.validation(`El archivo supera ${Math.round(this.deps.env.RAG_FETCH_MAX_BYTES / 1024 / 1024)} MB`);
    const sniffed = validateUpload(file.buffer, file.mimetype, file.originalname, ['pdf', 'text']);
    const source = await this.uploadSource(actor, collectionId);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const ext = sniffed.mediaType === 'application/pdf' ? '.pdf' : file.originalname.toLowerCase().endsWith('.html') || file.originalname.toLowerCase().endsWith('.htm') ? '.html' : sniffed.mediaType === 'text/markdown' ? '.md' : '.txt';
    const key = newKey(`rag/${actor.organizationId}`, ext);
    await this.deps.storage.put(key, file.buffer, sniffed.mediaType);
    const job = await this.jobs.enqueue({
      organizationId: actor.organizationId,
      kind: 'ingest-document',
      collectionId,
      sourceId: source.id,
      params: { externalId: `upload:${file.originalname}`, title: file.originalname.replace(/\.[^.]+$/, ''), storageKey: key, mediaType: sniffed.mediaType, filename: file.originalname, contentHash: hash, bytes: file.buffer.length, acl },
      createdBy: actor.userId,
    });
    await recordAudit(this.deps.db, actor, { action: 'rag.documents.upload', resourceType: 'rag_collection', resourceId: collectionId, outcome: 'success', metadata: { filename: file.originalname, bytes: file.buffer.length, jobId: job.id } });
    return { jobId: job.id, status: 'queued' };
  }

  /** Sources due by schedule (worker tick). */
  async due(limit = 20) {
    return this.deps.db
      .select()
      .from(ragSources)
      .where(and(eq(ragSources.status, 'active'), sql`${ragSources.schedule} is not null`, sql`${ragSources.nextSyncAt} <= now()`))
      .limit(limit);
  }
}

export class DocumentsService {
  constructor(
    private readonly deps: RagDeps,
    private readonly stores: StoreRegistry,
    private readonly collections: CollectionsService,
    private readonly jobs: RagJobsService,
  ) {}

  private dto(d: StoredDocument, collectionName: string) {
    return {
      id: d.id,
      collectionId: d.collectionId,
      collectionName,
      sourceId: d.sourceId,
      externalId: d.externalId,
      title: d.title,
      sourceUrl: d.sourceUrl,
      mediaType: d.mediaType,
      bytes: d.bytes,
      version: d.version,
      status: d.status,
      chunkCount: d.chunkCount,
      aclRoles: d.aclRoles,
      aclUsers: d.aclUsers,
      error: d.error,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      indexedAt: d.indexedAt?.toISOString() ?? null,
    };
  }

  /** Lists documents of readable collections, filtered by document ACL unless the actor manages knowledge. */
  async list(actor: Actor, q: { page?: number; pageSize?: number; collectionId?: string; status?: string; search?: string }) {
    assertCan(actor, 'rag.documents.read');
    const readable = await this.collections.readable(actor, q.collectionId ? [q.collectionId] : null, true);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, q.pageSize ?? 20);
    const byConn = new Map<string, typeof readable>();
    for (const r of readable) byConn.set(r.conn.id, [...(byConn.get(r.conn.id) ?? []), r]);
    const items: ReturnType<DocumentsService['dto']>[] = [];
    let total = 0;
    for (const group of byConn.values()) {
      const store = this.stores.get(group[0]!.conn);
      if (!store.capabilities().browse) continue;
      const principal = actor.permissions.has('rag.collections.manage') ? null : { userId: actor.userId, roleKeys: roleKeys(actor) };
      const res = await store.listDocuments({ collectionIds: group.map((g) => g.c.id), status: q.status, search: q.search, page, pageSize, principal });
      total += res.total;
      items.push(...res.items.map((d) => this.dto(d, group.find((g) => g.c.id === d.collectionId)?.c.name ?? '')));
    }
    return { items: items.slice(0, pageSize), page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
  }

  private async locate(actor: Actor, collectionId: string, id: string) {
    const [r] = await this.collections.readable(actor, [collectionId], true);
    if (!r) throw AppError.notFound('Documento');
    const store = this.stores.get(r.conn);
    const d = await store.getDocument(id);
    if (!d || d.collectionId !== collectionId || !canReadDocument(actor, d)) throw AppError.notFound('Documento');
    return { r, store, d };
  }

  async get(actor: Actor, collectionId: string, id: string) {
    assertCan(actor, 'rag.documents.read');
    const { r, store, d } = await this.locate(actor, collectionId, id);
    const chunks = await store.documentChunks(id, r.c.activeIndexVersionId, 500);
    return { ...this.dto(d, r.c.name), chunks };
  }

  async remove(actor: Actor, collectionId: string, id: string) {
    assertCan(actor, 'rag.documents.delete');
    const { d } = await this.locate(actor, collectionId, id);
    const job = await this.jobs.enqueue({ organizationId: actor.organizationId, kind: 'delete-document', collectionId, documentId: d.id, createdBy: actor.userId, idempotencyKey: `delete:${d.id}` });
    await recordAudit(this.deps.db, actor, { action: 'rag.documents.delete', resourceType: 'rag_document', resourceId: d.id, outcome: 'success', metadata: { title: d.title, collectionId, jobId: job.id } });
    return { jobId: job.id, status: 'queued' };
  }

  async reprocess(actor: Actor, collectionId: string, id: string) {
    assertCan(actor, 'rag.sources.manage');
    const { d } = await this.locate(actor, collectionId, id);
    const job = await this.jobs.enqueue({
      organizationId: actor.organizationId,
      kind: 'ingest-document',
      collectionId,
      sourceId: d.sourceId,
      documentId: d.id,
      params: { externalId: d.externalId, title: d.title, storageKey: d.storageKey, mediaType: d.mediaType, url: d.sourceUrl, force: true, acl: { roles: d.aclRoles, users: d.aclUsers } },
      createdBy: actor.userId,
      idempotencyKey: `ingest:${d.id}`,
    });
    return { jobId: job.id, status: 'queued' };
  }
}
