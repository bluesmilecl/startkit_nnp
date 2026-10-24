import { assertAllowedEndpoint } from '@starter/ai';
import { assertCan, recordAudit, type Actor } from '@starter/auth';
import { maskSecret } from '@starter/config';
import { AppError, type CreateRagConnectionInput, type RagConnection } from '@starter/contracts';
import { and, count, embeddingProfiles, eq, modelCatalog, ragCollections, ragConnections, type Database } from '@starter/db';
import { createPgPool, migratePgStore } from '../store/pg-store.js';
import type { StoreCapabilities, StoreDiagnostic } from '../store/types.js';
import type { ApiStore } from '../store/api-store.js';
import { connectionSecret, internalDdlUrl, type ConnectionRow, type RagDeps, type StoreRegistry } from './context.js';

/** RAG connections: where knowledge is stored and queried (internal, external PostgreSQL, API). */
export class RagConnectionsService {
  constructor(
    private readonly deps: RagDeps,
    private readonly stores: StoreRegistry,
  ) {}

  private toDto(r: ConnectionRow, collections: number): RagConnection {
    const config = r.config as { schema?: string; baseUrl?: string };
    return {
      id: r.id,
      name: r.name,
      kind: r.kind as RagConnection['kind'],
      status: r.status,
      schema: r.kind === 'api' ? null : (config.schema ?? 'rag'),
      baseUrl: config.baseUrl ?? null,
      access: r.access as 'read-write' | 'read-only',
      managed: r.managed,
      tls: r.tls,
      timeoutMs: r.timeoutMs,
      credentialSource: r.kind === 'internal' ? 'application' : r.credentialCiphertext ? 'stored' : r.credentialRef ? 'reference' : 'none',
      credentialHint: r.credentialRef ?? (r.config as { credentialHint?: string }).credentialHint ?? null,
      capabilities: r.capabilities && Object.keys(r.capabilities).length ? (r.capabilities as RagConnection['capabilities']) : null,
      diagnostic: (r.diagnostic as StoreDiagnostic | null) ?? null,
      diagnosedAt: r.diagnosedAt?.toISOString() ?? null,
      enabledAt: r.enabledAt?.toISOString() ?? null,
      collections,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(actor: Actor): Promise<RagConnection[]> {
    if (!actor.permissions.has('rag.collections.manage')) assertCan(actor, 'rag.collections.read');
    const rows = await this.deps.db.select().from(ragConnections).where(eq(ragConnections.organizationId, actor.organizationId)).orderBy(ragConnections.name);
    const counts = await this.deps.db
      .select({ id: ragCollections.ragConnectionId, n: count() })
      .from(ragCollections)
      .where(eq(ragCollections.organizationId, actor.organizationId))
      .groupBy(ragCollections.ragConnectionId);
    return rows.map((r) => this.toDto(r, counts.find((c) => c.id === r.id)?.n ?? 0));
  }

  async findRow(organizationId: string, id: string, db: Database = this.deps.db): Promise<ConnectionRow> {
    const [row] = await db.select().from(ragConnections).where(and(eq(ragConnections.id, id), eq(ragConnections.organizationId, organizationId))).limit(1);
    if (!row) throw AppError.notFound('Conexión de conocimiento');
    return row;
  }

  async get(actor: Actor, id: string) {
    assertCan(actor, 'rag.collections.manage');
    const row = await this.findRow(actor.organizationId, id);
    const [n] = await this.deps.db.select({ n: count() }).from(ragCollections).where(eq(ragCollections.ragConnectionId, id));
    return this.toDto(row, n?.n ?? 0);
  }

  private async secretFields(input: { kind: string; connectionUrl?: string; token?: string; credentialRef?: string | null }) {
    const secret = input.kind === 'postgres' ? input.connectionUrl : input.kind === 'api' ? input.token : undefined;
    if (secret) {
      if (input.kind === 'postgres') {
        let u: URL;
        try {
          u = new URL(secret);
        } catch {
          throw AppError.validation('Cadena de conexión inválida (postgres://usuario:clave@host:5432/base)');
        }
        if (!/^postgres(ql)?:$/.test(u.protocol)) throw AppError.validation('La cadena debe comenzar con postgres://');
        return { credentialCiphertext: this.deps.secrets.encrypt(secret), credentialRef: null, hint: `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}` };
      }
      return { credentialCiphertext: this.deps.secrets.encrypt(secret), credentialRef: null, hint: maskSecret(secret) };
    }
    if (input.credentialRef) return { credentialCiphertext: null, credentialRef: input.credentialRef, hint: input.credentialRef };
    return null;
  }

  async create(actor: Actor, input: CreateRagConnectionInput) {
    assertCan(actor, 'rag.collections.manage');
    if (!this.deps.features.rag) throw new AppError('FEATURE_DISABLED', 'El módulo de conocimiento está deshabilitado');
    const config: Record<string, unknown> = {};
    let secret: Awaited<ReturnType<RagConnectionsService['secretFields']>> = null;
    if (input.kind === 'internal') {
      config.schema = input.schema;
    } else if (input.kind === 'postgres') {
      config.schema = input.schema;
      secret = await this.secretFields(input);
      if (!secret) throw AppError.validation('Indica la cadena de conexión o una referencia a secreto');
    } else {
      if (!input.baseUrl) throw AppError.validation('Indica la URL base del servicio de recuperación');
      await assertAllowedEndpoint(input.baseUrl, { allowPrivate: this.deps.env.RAG_FETCH_ALLOW_PRIVATE });
      config.baseUrl = input.baseUrl.replace(/\/$/, '');
      secret = await this.secretFields(input);
    }
    if (secret?.hint) config.credentialHint = secret.hint;
    const [dup] = await this.deps.db.select({ id: ragConnections.id }).from(ragConnections).where(and(eq(ragConnections.organizationId, actor.organizationId), eq(ragConnections.name, input.name)));
    if (dup) throw AppError.conflict('Ya existe una conexión con ese nombre');
    const [row] = await this.deps.db
      .insert(ragConnections)
      .values({
        organizationId: actor.organizationId,
        name: input.name,
        kind: input.kind,
        location: input.kind === 'internal' ? 'same-database' : null,
        config,
        credentialCiphertext: secret?.credentialCiphertext ?? null,
        credentialRef: secret?.credentialRef ?? null,
        tls: input.tls,
        timeoutMs: input.timeoutMs,
        access: input.kind === 'api' ? 'read-only' : input.access,
        managed: input.kind === 'api' ? false : input.managed,
        createdBy: actor.userId,
      })
      .returning();
    await recordAudit(this.deps.db, actor, { action: 'rag.connections.create', resourceType: 'rag_connection', resourceId: row!.id, outcome: 'success', after: { name: input.name, kind: input.kind, schema: config.schema ?? null, baseUrl: config.baseUrl ?? null } });
    return this.toDto(row!, 0);
  }

  async update(actor: Actor, id: string, input: { name?: string; connectionUrl?: string; token?: string; credentialRef?: string | null; baseUrl?: string; tls?: 'disable' | 'require' | 'verify-full'; timeoutMs?: number; access?: 'read-write' | 'read-only'; managed?: boolean; disabled?: boolean }) {
    assertCan(actor, 'rag.collections.manage');
    const row = await this.findRow(actor.organizationId, id);
    const config = { ...(row.config as Record<string, unknown>) };
    const patch: Partial<typeof ragConnections.$inferInsert> = {};
    if (input.name) patch.name = input.name;
    if (input.baseUrl && row.kind === 'api') {
      await assertAllowedEndpoint(input.baseUrl, { allowPrivate: this.deps.env.RAG_FETCH_ALLOW_PRIVATE });
      config.baseUrl = input.baseUrl.replace(/\/$/, '');
    }
    const secret = await this.secretFields({ kind: row.kind, connectionUrl: input.connectionUrl, token: input.token, credentialRef: input.credentialRef });
    if (secret) {
      patch.credentialCiphertext = secret.credentialCiphertext;
      patch.credentialRef = secret.credentialRef;
      config.credentialHint = secret.hint;
    }
    if (input.tls) patch.tls = input.tls;
    if (input.timeoutMs) patch.timeoutMs = input.timeoutMs;
    if (input.access && row.kind !== 'api') patch.access = input.access;
    if (input.managed !== undefined && row.kind !== 'api') patch.managed = input.managed;
    if (input.disabled !== undefined) patch.status = input.disabled ? 'disabled' : 'pending';
    patch.config = config;
    const [updated] = await this.deps.db.update(ragConnections).set(patch).where(eq(ragConnections.id, id)).returning();
    await recordAudit(this.deps.db, actor, { action: 'rag.connections.update', resourceType: 'rag_connection', resourceId: id, outcome: 'success', after: { ...input, connectionUrl: input.connectionUrl ? '[cambiada]' : undefined, token: input.token ? '[cambiado]' : undefined } });
    const [n] = await this.deps.db.select({ n: count() }).from(ragCollections).where(eq(ragCollections.ragConnectionId, id));
    return this.toDto(updated!, n?.n ?? 0);
  }

  async remove(actor: Actor, id: string) {
    assertCan(actor, 'rag.collections.manage');
    await this.findRow(actor.organizationId, id);
    const [n] = await this.deps.db.select({ n: count() }).from(ragCollections).where(eq(ragCollections.ragConnectionId, id));
    if ((n?.n ?? 0) > 0) throw AppError.conflict('La conexión tiene colecciones; elimínalas primero');
    await this.deps.db.delete(ragConnections).where(eq(ragConnections.id, id));
    await recordAudit(this.deps.db, actor, { action: 'rag.connections.delete', resourceType: 'rag_connection', resourceId: id, outcome: 'success' });
  }

  /** Read-only checks; stores the result and the declared capabilities. */
  async diagnose(actor: Actor, id: string) {
    assertCan(actor, 'rag.collections.manage');
    const row = await this.findRow(actor.organizationId, id);
    const store = this.stores.get(row);
    let diagnostic: StoreDiagnostic;
    try {
      diagnostic = await store.diagnose();
    } catch (err) {
      diagnostic = { ok: false, checks: [{ key: 'connection', label: 'Conexión', status: 'error', detail: (err as Error).message.slice(0, 300) }], manualSteps: [], capabilities: store.capabilities(), latencyMs: 0 };
    }
    const status = row.status === 'disabled' ? 'disabled' : diagnostic.ok ? 'ready' : row.enabledAt ? 'error' : 'pending';
    await this.deps.db
      .update(ragConnections)
      .set({ diagnostic, diagnosedAt: new Date(), capabilities: diagnostic.capabilities as unknown as Record<string, boolean>, status })
      .where(eq(ragConnections.id, id));
    return this.get(actor, id);
  }

  /**
   * Prepares the store: extension, schema, migrations and grants (PostgreSQL), or capability
   * discovery (API). Never silent: failures return the exact manual steps.
   */
  async activate(actor: Actor, id: string) {
    assertCan(actor, 'rag.collections.manage');
    const row = await this.findRow(actor.organizationId, id);
    const schema = (row.config as { schema?: string }).schema ?? 'rag';
    let error: string | null = null;
    if (row.kind === 'internal' || row.kind === 'postgres') {
      if (!row.managed) error = 'La conexión no está administrada por el starter: prepara el esquema manualmente según el diagnóstico';
      else {
        const url = row.kind === 'internal' ? internalDdlUrl(this.deps) : connectionSecret(this.deps, row);
        const ddl = createPgPool(url!, { ssl: row.kind === 'internal' ? this.deps.env.DATABASE_SSL : row.tls, max: 1, timeoutMs: 60_000, applicationName: 'starter-rag-ddl' });
        try {
          const runtimeUser = row.kind === 'internal' ? decodeURIComponent(new URL(this.deps.env.DATABASE_URL).username) : null;
          const ddlUser = decodeURIComponent(new URL(url!).username);
          await migratePgStore(ddl, schema, { createExtension: true, grantTo: runtimeUser && runtimeUser !== ddlUser ? runtimeUser : null });
        } catch (err) {
          error = (err as Error).message;
        } finally {
          await ddl.end().catch(() => {});
        }
      }
    }
    if (row.kind === 'api') {
      try {
        await (this.stores.get(row) as ApiStore).loadCapabilities();
      } catch (err) {
        error = (err as Error).message;
      }
    }
    await this.deps.db.update(ragConnections).set({ enabledAt: error ? row.enabledAt : new Date(), enabledBy: error ? row.enabledBy : actor.userId }).where(eq(ragConnections.id, id));
    await recordAudit(this.deps.db, actor, { action: 'rag.connections.activate', resourceType: 'rag_connection', resourceId: id, outcome: error ? 'failed' : 'success', metadata: { kind: row.kind, schema, error } });
    const result = await this.diagnose(actor, id);
    if (error && result.diagnostic) result.diagnostic.manualSteps.unshift(`No se pudo preparar automáticamente: ${error.slice(0, 300)}`);
    return result;
  }

  async capabilities(row: ConnectionRow): Promise<StoreCapabilities> {
    return this.stores.get(row).capabilities();
  }
}

/** Embedding profiles: model + dimensions + metric. Changing them requires a reindex. */
export class EmbeddingProfilesService {
  constructor(private readonly deps: RagDeps) {}

  async list(actor: Actor) {
    if (!actor.permissions.has('rag.collections.manage')) assertCan(actor, 'rag.collections.read');
    const rows = await this.deps.db.select().from(embeddingProfiles).where(eq(embeddingProfiles.organizationId, actor.organizationId)).orderBy(embeddingProfiles.name);
    const counts = await this.deps.db.select({ id: ragCollections.embeddingProfileId, n: count() }).from(ragCollections).groupBy(ragCollections.embeddingProfileId);
    const catalog = rows.length ? await this.deps.db.select({ id: modelCatalog.id, connectionId: modelCatalog.connectionId, modelId: modelCatalog.modelId }).from(modelCatalog) : [];
    return rows.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      connectionId: p.connectionId,
      provider: p.provider,
      modelId: p.modelId,
      modelCatalogId: catalog.find((m) => m.connectionId === p.connectionId && m.modelId === p.modelId)?.id ?? null,
      dimensions: p.dimensions,
      metric: p.metric,
      indexType: p.indexType,
      collections: counts.find((c) => c.id === p.id)?.n ?? 0,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  static indexTypeFor(dimensions: number): string {
    return dimensions <= 2000 ? 'hnsw' : dimensions <= 4000 ? 'hnsw_halfvec' : 'none';
  }

  async create(actor: Actor, input: { key: string; name: string; modelCatalogId: string; metric: 'cosine' | 'l2' | 'inner_product'; dimensions?: number }) {
    assertCan(actor, 'rag.collections.manage');
    const m = await this.deps.ai.runtime.resolve(actor.organizationId, input.modelCatalogId);
    if (!m.functions.includes('embedding')) throw AppError.validation(`${m.modelId} no es un modelo de embeddings`);
    const dimensions = m.embeddingDimensions ?? input.dimensions;
    if (!dimensions) throw AppError.validation('El catálogo no declara las dimensiones de este modelo; indícalas');
    if (m.embeddingDimensions && input.dimensions && input.dimensions !== m.embeddingDimensions) throw AppError.validation(`El modelo produce vectores de ${m.embeddingDimensions} dimensiones`);
    const [dup] = await this.deps.db.select({ id: embeddingProfiles.id }).from(embeddingProfiles).where(and(eq(embeddingProfiles.organizationId, actor.organizationId), eq(embeddingProfiles.key, input.key)));
    if (dup) throw AppError.conflict('Ya existe un perfil con esa clave');
    const [p] = await this.deps.db
      .insert(embeddingProfiles)
      .values({ organizationId: actor.organizationId, key: input.key, name: input.name, connectionId: m.connectionId, provider: m.provider, modelId: m.modelId, dimensions, metric: input.metric, indexType: EmbeddingProfilesService.indexTypeFor(dimensions), createdBy: actor.userId })
      .returning();
    await recordAudit(this.deps.db, actor, { action: 'rag.profiles.create', resourceType: 'embedding_profile', resourceId: p!.id, outcome: 'success', after: { model: m.modelId, dimensions, metric: input.metric } });
    return (await this.list(actor)).find((x) => x.id === p!.id)!;
  }

  async remove(actor: Actor, id: string) {
    assertCan(actor, 'rag.collections.manage');
    const [n] = await this.deps.db.select({ n: count() }).from(ragCollections).where(eq(ragCollections.embeddingProfileId, id));
    if ((n?.n ?? 0) > 0) throw AppError.conflict('El perfil está en uso por colecciones');
    const rows = await this.deps.db.delete(embeddingProfiles).where(and(eq(embeddingProfiles.id, id), eq(embeddingProfiles.organizationId, actor.organizationId))).returning();
    if (!rows.length) throw AppError.notFound('Perfil');
    await recordAudit(this.deps.db, actor, { action: 'rag.profiles.delete', resourceType: 'embedding_profile', resourceId: id, outcome: 'success' });
  }

  /** Catalog model used to embed with this profile (must exist and be enabled). */
  async modelCatalogIdFor(profile: typeof embeddingProfiles.$inferSelect): Promise<string> {
    const [m] = await this.deps.db
      .select({ id: modelCatalog.id })
      .from(modelCatalog)
      .where(and(eq(modelCatalog.connectionId, profile.connectionId), eq(modelCatalog.modelId, profile.modelId)))
      .limit(1);
    if (!m) throw new AppError('NOT_CONFIGURED', `El modelo de embeddings ${profile.modelId} ya no está en el catálogo`);
    return m.id;
  }
}
