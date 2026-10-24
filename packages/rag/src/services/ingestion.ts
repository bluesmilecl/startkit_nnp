import { recordAudit, systemActor } from '@starter/auth';
import { AppError, isAppError, isRetryableError } from '@starter/contracts';
import { and, embeddingProfiles, eq, ragCollections, ragConnections, ragSources, sql, syncRuns } from '@starter/db';
import { createLogger, sanitizeError } from '@starter/observability';
import { newKey } from '@starter/storage';
import { createHash } from 'node:crypto';
import { chunkSections, DEFAULT_CHUNKING, type TextChunk } from '../parsing/chunking.js';
import { safeFetch } from '../parsing/fetch.js';
import { parseDocument, parseSitemap } from '../parsing/parse.js';
import type { ApiStore } from '../store/api-store.js';
import type { IndexSpace, RagStore, StoredDocument } from '../store/types.js';
import { nextRun, type SourcesService } from './collections.js';
import type { EmbeddingProfilesService } from './connections.js';
import type { RagDeps, StoreRegistry } from './context.js';
import { JobCancelledError, type RagJobsService } from './jobs.js';

const log = createLogger('rag-ingestion');
const EMBED_BATCH = 32;
type JobRow = NonNullable<Awaited<ReturnType<RagJobsService['load']>>>;
type ProfileRow = typeof embeddingProfiles.$inferSelect;

interface IngestParams {
  externalId: string;
  title?: string | null;
  storageKey?: string | null;
  mediaType?: string | null;
  url?: string | null;
  filename?: string | null;
  contentHash?: string | null;
  bytes?: number | null;
  /** Reprocess even when the content did not change (manual "reprocess"). */
  force?: boolean;
  /** Download the URL again (scheduled/manual source sync); unchanged content is not re-embedded. */
  refetch?: boolean;
  acl?: { roles: string[]; users: string[] };
}

/** Errors that will not succeed on retry. */
function permanent(err: unknown): boolean {
  return err instanceof JobCancelledError || !isRetryableError(err);
}

export class IngestionService {
  constructor(
    private readonly deps: RagDeps,
    private readonly stores: StoreRegistry,
    private readonly profiles: EmbeddingProfilesService,
    private readonly sources: SourcesService,
    private readonly jobs: RagJobsService,
  ) {}

  /** Worker entry point for every RAG queue. */
  async run(ragJobId: string, retryCount: number): Promise<void> {
    const job = await this.jobs.load(ragJobId);
    if (!job || ['succeeded', 'cancelled'].includes(job.status)) return;
    if (job.cancelRequestedAt) {
      await this.jobs.finish(job.id, 'cancelled');
      return;
    }
    await this.jobs.start(job.id, retryCount);
    try {
      switch (job.kind) {
        case 'ingest-document':
          await this.ingestDocument(job);
          break;
        case 'ingest-source':
          await this.ingestSource(job);
          break;
        case 'reindex':
          await this.reindex(job);
          break;
        case 'delete-document':
          await this.deleteDocument(job);
          break;
        case 'purge-collection':
          await this.purgeCollection(job);
          break;
        default:
          throw AppError.validation(`Tipo de trabajo desconocido: ${job.kind}`);
      }
      await this.jobs.finish(job.id, 'succeeded');
    } catch (err) {
      const message = err instanceof JobCancelledError ? 'Cancelado' : isAppError(err) ? err.message : sanitizeError(err, 500);
      if (err instanceof JobCancelledError) {
        await this.jobs.finish(job.id, 'cancelled', null);
        return;
      }
      if (permanent(err) || retryCount + 1 >= job.maxAttempts) {
        await this.jobs.finish(job.id, 'failed', message);
        if (job.documentId) await this.markDocumentFailed(job, message);
        log.warn({ jobId: job.id, kind: job.kind, err: message }, 'rag job failed');
        return;
      }
      await this.jobs.markRetrying(job.id, message);
      throw err;
    }
  }

  private async context(job: JobRow) {
    if (!job.collectionId) throw AppError.validation('Trabajo sin colección');
    const [row] = await this.deps.db
      .select({ c: ragCollections, conn: ragConnections, p: embeddingProfiles })
      .from(ragCollections)
      .innerJoin(ragConnections, eq(ragConnections.id, ragCollections.ragConnectionId))
      .leftJoin(embeddingProfiles, eq(embeddingProfiles.id, ragCollections.embeddingProfileId))
      .where(eq(ragCollections.id, job.collectionId));
    if (!row) throw AppError.notFound('Colección', 'f');
    return { ...row, store: this.stores.get(row.conn) };
  }

  private async markDocumentFailed(job: JobRow, message: string) {
    try {
      const { store } = await this.context(job);
      if (store.capabilities().browse) await store.setDocumentStatus(job.documentId!, 'failed', message.slice(0, 1000));
    } catch {
      /* best effort */
    }
  }

  private space(profile: ProfileRow, indexVersionId: string, language: string): IndexSpace {
    return { indexVersionId, profileId: profile.id, dimensions: profile.dimensions, metric: profile.metric, indexType: profile.indexType, tsConfig: language };
  }

  /** Embeds chunk texts in batches through the AI runtime (ledger, budgets, job cost). */
  private async embed(job: JobRow, profile: ProfileRow, chunks: TextChunk[], progressOffset = 0, progressTotal: number | null = null): Promise<number[][]> {
    const modelCatalogId = await this.profiles.modelCatalogIdFor(profile);
    const out: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      await this.jobs.checkCancelled(job.id);
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const r = await this.deps.ai.runtime.embed({ organizationId: job.organizationId, userId: job.createdBy, feature: 'embedding', jobId: job.id, metadata: { collectionId: job.collectionId } }, modelCatalogId, batch.map((c) => (c.heading ? `${c.heading}\n${c.text}` : c.text)));
      for (const e of r.embeddings) {
        if (e.length !== profile.dimensions) throw new AppError('VALIDATION_FAILED', `El modelo devolvió ${e.length} dimensiones; el perfil espera ${profile.dimensions}`);
      }
      out.push(...r.embeddings);
      await this.jobs.addCost(job.id, { embedding_tokens: r.tokens }, r.costUsd);
      await this.jobs.stage(job.id, 'embed', progressOffset + Math.min(i + EMBED_BATCH, chunks.length), progressTotal ?? chunks.length);
    }
    return out;
  }

  private async loadBody(params: IngestParams, orgId: string): Promise<{ body: Buffer; storageKey: string; mediaType: string; url: string | null }> {
    if (params.url && (!params.storageKey || params.force || params.refetch)) {
      const res = await safeFetch(params.url, { allowPrivate: this.deps.env.RAG_FETCH_ALLOW_PRIVATE, maxBytes: this.deps.env.RAG_FETCH_MAX_BYTES });
      // The fetched original is kept so reindexing never depends on the remote site.
      const key = params.storageKey ?? newKey(`rag/${orgId}`, res.contentType === 'application/pdf' ? '.pdf' : '.html');
      await this.deps.storage.put(key, res.body, res.contentType);
      return { body: res.body, storageKey: key, mediaType: res.contentType, url: res.url };
    }
    if (!params.storageKey) throw AppError.validation('El documento no tiene contenido almacenado');
    return { body: await this.deps.storage.getBuffer(params.storageKey, this.deps.env.RAG_FETCH_MAX_BYTES + 1024), storageKey: params.storageKey, mediaType: params.mediaType ?? 'text/plain', url: params.url ?? null };
  }

  private async ingestDocument(job: JobRow) {
    const params = job.params as unknown as IngestParams;
    const { c, conn, p, store } = await this.context(job);
    if (c.status !== 'active') throw AppError.validation('La colección no está activa');
    if (!store.capabilities().ingest) throw new AppError('CAPABILITY_UNSUPPORTED', 'La conexión es de solo lectura');
    const t0 = Date.now();
    await this.jobs.stage(job.id, 'fetch', 0, null);
    const loaded = await this.loadBody(params, job.organizationId);
    await this.jobs.timing(job.id, 'fetch', Date.now() - t0);
    const contentHash = createHash('sha256').update(loaded.body).digest('hex');

    const t1 = Date.now();
    await this.jobs.stage(job.id, 'parse');
    const parsed = await parseDocument(loaded.body, loaded.mediaType, params.filename ?? params.url ?? params.externalId, loaded.url);
    const chunking = { ...DEFAULT_CHUNKING, ...(c.chunking as object) };
    const chunks = chunkSections(parsed.sections, chunking);
    if (!chunks.length) throw AppError.validation('El documento no contiene texto indexable');
    await this.jobs.timing(job.id, 'parse', Date.now() - t1);
    const title = params.title || parsed.title || params.filename || params.url || params.externalId;
    const acl = params.acl ?? { roles: [], users: [] };

    if (conn.kind === 'api') {
      await this.jobs.stage(job.id, 'push');
      await (store as ApiStore).pushDocument(c.id, params.externalId, { title, url: loaded.url, text: parsed.sections.map((s) => (s.heading ? `## ${s.heading}\n${s.text}` : s.text)).join('\n\n'), metadata: { mediaType: parsed.mediaType }, acl });
      return;
    }
    if (!p) throw new AppError('NOT_CONFIGURED', 'La colección no tiene perfil de embeddings');
    if (!c.activeIndexVersionId) throw new AppError('NOT_CONFIGURED', 'La colección no tiene índice activo');

    const { document, changed } = await store.upsertDocument({
      organizationId: job.organizationId,
      collectionId: c.id,
      sourceId: job.sourceId,
      externalId: params.externalId,
      title,
      sourceUrl: loaded.url,
      mediaType: parsed.mediaType,
      language: parsed.language ?? c.language,
      contentHash,
      storageKey: loaded.storageKey,
      bytes: loaded.body.length,
      aclRoles: acl.roles,
      aclUsers: acl.users,
      metadata: { filename: params.filename ?? null },
    });
    await this.deps.db.execute(sql`update rag_jobs set document_id = ${document.id} where id = ${job.id}`);
    if (!changed && !params.force) {
      await this.jobs.stage(job.id, 'unchanged', 1, 1);
      if (job.sourceId) await this.countUnchanged(job.sourceId);
      if (params.storageKey !== loaded.storageKey || (document.storageKey && document.storageKey !== loaded.storageKey)) await this.deps.storage.delete(loaded.storageKey).catch(() => {});
      return;
    }
    await store.setDocumentStatus(document.id, 'processing');
    const t2 = Date.now();
    const vectors = await this.embed(job, p, chunks);
    await this.jobs.timing(job.id, 'embed', Date.now() - t2);
    const t3 = Date.now();
    await this.jobs.stage(job.id, 'write', chunks.length, chunks.length);
    await store.replaceChunks(document.id, c.id, this.space(p, c.activeIndexVersionId, c.language), chunks.map((ch, i) => ({ ...ch, embedding: vectors[i] ?? null })));
    await store.setDocumentStatus(document.id, 'indexed');
    await this.jobs.timing(job.id, 'write', Date.now() - t3);
  }

  private async ingestSource(job: JobRow) {
    const [s] = await this.deps.db.select().from(ragSources).where(eq(ragSources.id, job.sourceId!));
    if (!s) throw AppError.notFound('Fuente', 'f');
    const { c, store } = await this.context(job);
    const [run] = await this.deps.db.insert(syncRuns).values({ organizationId: job.organizationId, sourceId: s.id, jobId: job.id }).returning();
    const stats = { discovered: 0, added: 0, updated: 0, removed: 0, unchanged: 0, failed: 0 };
    const acl = (s.config.acl as { roles: string[]; users: string[] }) ?? { roles: [], users: [] };
    try {
      await this.jobs.stage(job.id, 'discover');
      let urls: string[] = [];
      if (s.kind === 'url') urls = [String(s.config.url)];
      else if (s.kind === 'sitemap') urls = await this.discoverSitemap(String(s.config.url), Number(s.config.maxUrls ?? 200), (s.config.include as string | null) ?? null, (s.config.exclude as string | null) ?? null);
      stats.discovered = s.kind === 'text' ? 1 : urls.length;
      const existing = store.capabilities().browse ? (await store.listDocuments({ collectionIds: [c.id], page: 1, pageSize: 10_000 })).items.filter((d) => d.sourceId === s.id) : [];
      await this.jobs.stage(job.id, 'enqueue', 0, stats.discovered);
      if (s.kind === 'text') {
        const prev = existing[0];
        await this.jobs.enqueue({
          organizationId: job.organizationId,
          kind: 'ingest-document',
          collectionId: c.id,
          sourceId: s.id,
          params: { externalId: `text:${s.id}`, title: s.config.title, storageKey: s.config.storageKey, mediaType: 'text/markdown', acl },
          createdBy: job.createdBy,
          idempotencyKey: `ingest:${c.id}:text:${s.id}`,
        });
        if (prev) stats.updated++;
        else stats.added++;
        await this.jobs.stage(job.id, 'enqueue', 1, 1);
      } else {
        for (const [i, url] of urls.entries()) {
          await this.jobs.checkCancelled(job.id);
          const prev = existing.find((d) => d.externalId === url);
          await this.jobs.enqueue({
            organizationId: job.organizationId,
            kind: 'ingest-document',
            collectionId: c.id,
            sourceId: s.id,
            params: { externalId: url, url, storageKey: prev?.storageKey ?? null, refetch: true, acl },
            createdBy: job.createdBy,
            idempotencyKey: `ingest:${c.id}:${createHash('sha1').update(url).digest('hex')}`,
          });
          if (prev) stats.updated++;
          else stats.added++;
          await this.jobs.stage(job.id, 'enqueue', i + 1, urls.length);
        }
        // Documents that disappeared from the source are removed (vectors and files).
        for (const d of existing.filter((x) => !urls.includes(x.externalId))) {
          await this.jobs.enqueue({ organizationId: job.organizationId, kind: 'delete-document', collectionId: c.id, documentId: d.id, createdBy: job.createdBy, idempotencyKey: `delete:${d.id}` });
          stats.removed++;
        }
      }
      await this.deps.db.update(syncRuns).set({ ...stats, finishedAt: new Date(), status: 'succeeded' }).where(eq(syncRuns.id, run!.id));
      await this.deps.db
        .update(ragSources)
        .set({ lastSyncAt: new Date(), lastError: null, status: s.status === 'error' ? 'active' : s.status, nextSyncAt: s.schedule ? nextRun(s.schedule) : null, stats })
        .where(eq(ragSources.id, s.id));
    } catch (err) {
      const message = isAppError(err) ? err.message : sanitizeError(err, 300);
      await this.deps.db.update(syncRuns).set({ ...stats, finishedAt: new Date(), status: 'failed' }).where(eq(syncRuns.id, run!.id));
      await this.deps.db.update(ragSources).set({ lastError: message, status: 'error', nextSyncAt: s.schedule ? nextRun(s.schedule) : null }).where(eq(ragSources.id, s.id));
      throw err;
    }
  }

  /** A re-synced page whose content did not change counts as unchanged, not updated. */
  private async countUnchanged(sourceId: string) {
    await this.deps.db.execute(sql`
      update sync_runs set unchanged = unchanged + 1, updated = greatest(updated - 1, 0)
      where id = (select id from sync_runs where source_id = ${sourceId} order by started_at desc limit 1)`);
    await this.deps.db.execute(sql`
      update rag_sources set stats = jsonb_set(jsonb_set(coalesce(stats, '{}'::jsonb), '{unchanged}', to_jsonb(coalesce((stats->>'unchanged')::int, 0) + 1)),
        '{updated}', to_jsonb(greatest(coalesce((stats->>'updated')::int, 0) - 1, 0)))
      where id = ${sourceId}`);
  }

  private async discoverSitemap(url: string, maxUrls: number, include: string | null, exclude: string | null): Promise<string[]> {
    const inc = include ? new RegExp(include) : null;
    const exc = exclude ? new RegExp(exclude) : null;
    const seen = new Set<string>();
    const queue = [url];
    let fetched = 0;
    while (queue.length && fetched < 10 && seen.size < maxUrls) {
      const res = await safeFetch(queue.shift()!, { allowPrivate: this.deps.env.RAG_FETCH_ALLOW_PRIVATE, maxBytes: this.deps.env.RAG_FETCH_MAX_BYTES, accept: 'application/xml,text/xml' });
      fetched++;
      const { urls, sitemaps } = parseSitemap(res.body.toString('utf8'));
      queue.push(...sitemaps);
      for (const u of urls) {
        if (seen.size >= maxUrls) break;
        if (inc && !inc.test(u)) continue;
        if (exc && exc.test(u)) continue;
        seen.add(u);
      }
    }
    if (!seen.size) throw AppError.validation('El sitemap no contiene URLs (o ninguna coincide con los filtros)');
    return [...seen];
  }

  /** New index version built in the background; searches keep using the active one until the switch. */
  private async reindex(job: JobRow) {
    const { c, store } = await this.context(job);
    const profileId = String((job.params as { profileId?: string }).profileId ?? c.embeddingProfileId);
    const [profile] = await this.deps.db.select().from(embeddingProfiles).where(eq(embeddingProfiles.id, profileId));
    if (!profile) throw AppError.notFound('Perfil de embeddings');
    await store.ensureProfileIndex({ profileId: profile.id, dimensions: profile.dimensions, metric: profile.metric, indexType: profile.indexType });
    let versionId = c.buildingIndexVersionId;
    if (!versionId) {
      versionId = await store.createIndexVersion(c.id, { profileId: profile.id, dimensions: profile.dimensions, metric: profile.metric, indexType: profile.indexType, tsConfig: c.language });
      await this.deps.db.update(ragCollections).set({ buildingIndexVersionId: versionId }).where(eq(ragCollections.id, c.id));
    }
    const space = this.space(profile, versionId, c.language);
    const started = new Date();
    const chunking = { ...DEFAULT_CHUNKING, ...(c.chunking as object) };
    const failures = new Map<string, string>();
    try {
      const process = async (docs: StoredDocument[], offset: number, total: number) => {
        for (const [i, d] of docs.entries()) {
          await this.jobs.checkCancelled(job.id);
          await this.jobs.stage(job.id, 'reindex', offset + i, total);
          try {
            const loaded = await this.loadBody({ externalId: d.externalId, storageKey: d.storageKey, mediaType: d.mediaType, url: d.sourceUrl }, job.organizationId);
            const parsed = await parseDocument(loaded.body, loaded.mediaType, d.externalId, loaded.url);
            const chunks = chunkSections(parsed.sections, chunking);
            const vectors = await this.embed(job, profile, chunks, offset + i, total);
            await store.replaceChunks(d.id, c.id, space, chunks.map((ch, k) => ({ ...ch, embedding: vectors[k] ?? null })));
          } catch (err) {
            if (err instanceof JobCancelledError || (isAppError(err) && err.code === 'BUDGET_EXCEEDED')) throw err;
            failures.set(d.id, isAppError(err) ? err.message : sanitizeError(err, 300));
            log.warn({ documentId: d.id, err: sanitizeError(err) }, 'document failed during reindex');
          }
        }
      };
      const all = (await store.listDocuments({ collectionIds: [c.id], page: 1, pageSize: 100_000 })).items.filter((d) => d.status === 'indexed');
      await process(all, 0, all.length);
      // Catch-up: documents ingested while the new version was being built.
      const late = (await store.listDocuments({ collectionIds: [c.id], page: 1, pageSize: 100_000 })).items.filter((d) => d.status === 'indexed' && d.updatedAt > started);
      if (late.length) await process(late, all.length, all.length + late.length);
      await this.jobs.stage(job.id, 'activate', all.length + late.length, all.length + late.length);
      const { retired } = await store.activateIndexVersion(c.id, versionId);
      await this.deps.db
        .update(ragCollections)
        .set({ activeIndexVersionId: versionId, buildingIndexVersionId: null, embeddingProfileId: profile.id, cacheEpoch: sql`${ragCollections.cacheEpoch} + 1` })
        .where(eq(ragCollections.id, c.id));
      for (const r of retired) await store.deleteIndexVersion(r);
      // Documents that could not be rebuilt have no fragments in the new version: make them
      // visible as failed (with the reason) so they can be reprocessed from the panel.
      for (const [id, message] of failures) await store.setDocumentStatus(id, 'failed', `Reindexación: ${message}`.slice(0, 1000)).catch(() => {});
      if (failures.size) await this.jobs.addCost(job.id, { failed: failures.size }, '0');
      await recordAudit(this.deps.db, systemActor(job.organizationId), { action: 'rag.collections.reindexed', resourceType: 'rag_collection', resourceId: c.id, outcome: 'success', metadata: { profile: profile.name, documents: all.length + late.length, failed: failures.size, jobId: job.id } });
    } catch (err) {
      await store.deleteIndexVersion(versionId).catch(() => {});
      await this.deps.db.update(ragCollections).set({ buildingIndexVersionId: null }).where(eq(ragCollections.id, c.id));
      throw err;
    }
  }

  private async deleteDocument(job: JobRow) {
    const { store } = await this.context(job);
    if (!job.documentId) throw AppError.validation('Trabajo sin documento');
    await this.jobs.stage(job.id, 'delete');
    const { storageKey } = await store.deleteDocument(job.documentId, job.collectionId);
    if (storageKey) await this.deps.storage.delete(storageKey).catch(() => {});
    await recordAudit(this.deps.db, systemActor(job.organizationId), { action: 'rag.documents.purged', resourceType: 'rag_document', resourceId: job.documentId, outcome: 'success', metadata: { jobId: job.id } });
  }

  private async purgeCollection(job: JobRow) {
    const { c, store } = await this.context(job);
    await this.jobs.stage(job.id, 'purge');
    const { storageKeys } = await store.deleteCollection(c.id);
    const textSources = await this.deps.db.select().from(ragSources).where(and(eq(ragSources.collectionId, c.id), eq(ragSources.kind, 'text')));
    for (const k of [...storageKeys, ...textSources.map((s) => String(s.config.storageKey ?? ''))].filter(Boolean)) await this.deps.storage.delete(k).catch(() => {});
    await this.deps.db.delete(ragCollections).where(eq(ragCollections.id, c.id));
    await recordAudit(this.deps.db, systemActor(job.organizationId), { action: 'rag.collections.purged', resourceType: 'rag_collection', resourceId: c.id, outcome: 'success', metadata: { name: c.name, files: storageKeys.length } });
  }

  /** Scheduled sources and collection retention (worker tick). */
  async tick(): Promise<{ syncs: number; expired: number }> {
    let syncs = 0;
    for (const s of await this.sources.due()) {
      await this.deps.db.update(ragSources).set({ nextSyncAt: s.schedule ? nextRun(s.schedule) : null }).where(eq(ragSources.id, s.id));
      await this.jobs.enqueue({ organizationId: s.organizationId, kind: 'ingest-source', collectionId: s.collectionId, sourceId: s.id, idempotencyKey: `sync:${s.id}` });
      syncs++;
    }
    let expired = 0;
    const withRetention = await this.deps.db
      .select({ c: ragCollections, conn: ragConnections })
      .from(ragCollections)
      .innerJoin(ragConnections, eq(ragConnections.id, ragCollections.ragConnectionId))
      .where(and(sql`${ragCollections.retentionDays} is not null`, eq(ragCollections.status, 'active')));
    for (const { c, conn } of withRetention) {
      const store: RagStore = this.stores.get(conn);
      if (!store.capabilities().browse || !store.capabilities().delete) continue;
      const cutoff = Date.now() - c.retentionDays! * 86_400_000;
      const docs = (await store.listDocuments({ collectionIds: [c.id], page: 1, pageSize: 1000 })).items.filter((d) => d.updatedAt.getTime() < cutoff);
      for (const d of docs) {
        await this.jobs.enqueue({ organizationId: c.organizationId, kind: 'delete-document', collectionId: c.id, documentId: d.id, idempotencyKey: `delete:${d.id}` });
        expired++;
      }
    }
    return { syncs, expired };
  }
}
