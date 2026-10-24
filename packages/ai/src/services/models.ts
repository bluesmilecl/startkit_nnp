import { assertCan, recordAudit, type Actor } from '@starter/auth';
import { AppError, type CatalogModel } from '@starter/contracts';
import { and, asc, count, eq, ilike, inArray, likeTerm, modelCapabilities, modelCatalog, normalizePage, offsetOf, or, outerRef, priceSyncRuns, providerConnections, sql, type SQL, toPage } from '@starter/db';
import { sanitizeError } from '@starter/observability';
import { embed, experimental_transcribe as transcribe, generateText } from 'ai';
import { guessFunctions, loadCatalog, type CatalogEntry } from '../catalog-source.js';
import { classifyAiError } from '../errors.js';
import { PROVIDERS, type DiscoveredModel, type ProviderKey } from '../providers/registry.js';
import type { AiDeps, ConnectionsService } from './connections.js';
import { UsageLedger, unitsFromUsage } from './ledger.js';
import { PricesService } from './prices.js';

type ModelRow = typeof modelCatalog.$inferSelect;

/** Half a second of silence (16 kHz mono PCM WAV) for transcription availability checks. */
function silentWav(seconds = 0.5): Uint8Array {
  const rate = 16_000;
  const samples = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return new Uint8Array(buf);
}

export interface ModelsListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  function?: string;
  capability?: string;
  connectionId?: string;
  availability?: string;
  sort?: 'name' | 'inputPrice' | 'context';
}

export class ModelsService {
  private readonly prices: PricesService;
  private readonly ledger: UsageLedger;

  constructor(
    private readonly deps: AiDeps,
    private readonly connections: ConnectionsService,
  ) {
    this.prices = new PricesService(deps);
    this.ledger = new UsageLedger(deps.db, this.prices);
  }

  private readable(actor: Actor): void {
    if (!['ai.models.manage', 'ai.agents.manage', 'ai.lab.use', 'ai.providers.manage', 'rag.collections.manage'].some((p) => actor.permissions.has(p as never))) {
      assertCan(actor, 'ai.models.manage');
    }
  }

  async toDtos(rows: { m: ModelRow; alias: string }[]): Promise<CatalogModel[]> {
    if (!rows.length) return [];
    const caps = await this.deps.db.select().from(modelCapabilities).where(inArray(modelCapabilities.modelCatalogId, rows.map((r) => r.m.id)));
    const priceMap = await this.prices.currentDtosForMany(rows.map((r) => ({ provider: r.m.provider, modelId: r.m.modelId, connectionId: r.m.connectionId })));
    return rows.map(({ m, alias }) => {
      const cap: Record<string, 'yes' | 'no' | 'unknown'> = {};
      for (const c of caps) if (c.modelCatalogId === m.id) cap[c.capability] = c.status;
      const prices = priceMap.get(`${m.provider}:${m.modelId}:${m.connectionId}`) ?? [];
      return {
        id: m.id,
        connectionId: m.connectionId,
        connectionAlias: alias,
        provider: m.provider as ProviderKey,
        modelId: m.modelId,
        displayName: m.displayName,
        family: m.family,
        functions: m.functions,
        inputModalities: m.inputModalities,
        outputModalities: m.outputModalities,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        embeddingDimensions: m.embeddingDimensions,
        capabilities: cap,
        availability: m.availability as CatalogModel['availability'],
        source: m.source as CatalogModel['source'],
        sourceUrl: m.sourceUrl,
        lastVerifiedAt: m.lastVerifiedAt?.toISOString() ?? null,
        lastSyncedAt: m.lastSyncedAt?.toISOString() ?? null,
        enabled: m.enabled,
        prices,
      };
    });
  }

  async list(actor: Actor, q: ModelsListQuery) {
    this.readable(actor);
    const params = normalizePage(q, 200);
    const filters: (SQL | undefined)[] = [eq(providerConnections.organizationId, actor.organizationId)];
    if (q.search) filters.push(or(ilike(modelCatalog.modelId, likeTerm(q.search)), ilike(modelCatalog.displayName, likeTerm(q.search))));
    if (q.function) filters.push(sql`${q.function} = any(${modelCatalog.functions})`);
    if (q.connectionId) filters.push(eq(modelCatalog.connectionId, q.connectionId));
    if (q.availability) filters.push(eq(modelCatalog.availability, q.availability));
    if (q.capability) {
      filters.push(sql`exists (select 1 from ${modelCapabilities} c where c.model_catalog_id = ${outerRef(modelCatalog.id)} and c.capability = ${q.capability} and c.status = 'yes')`);
    }
    const where = and(...filters);
    const order =
      q.sort === 'context'
        ? [sql`${modelCatalog.contextWindow} desc nulls last`, asc(modelCatalog.modelId)]
        : q.sort === 'inputPrice'
          ? [sql`(select min(p.price) from model_prices p where p.provider = ${outerRef(modelCatalog.provider)} and p.model_id = ${outerRef(modelCatalog.modelId)} and p.unit = 'input_tokens' and p.effective_to is null) asc nulls last`, asc(modelCatalog.modelId)]
          : [asc(modelCatalog.provider), asc(modelCatalog.modelId)];
    const [rows, total] = await Promise.all([
      this.deps.db
        .select({ m: modelCatalog, alias: providerConnections.alias })
        .from(modelCatalog)
        .innerJoin(providerConnections, eq(providerConnections.id, modelCatalog.connectionId))
        .where(where)
        .orderBy(...order)
        .limit(params.pageSize)
        .offset(offsetOf(params)),
      this.deps.db.select({ n: count() }).from(modelCatalog).innerJoin(providerConnections, eq(providerConnections.id, modelCatalog.connectionId)).where(where),
    ]);
    return toPage(await this.toDtos(rows), total[0]?.n ?? 0, params);
  }

  async findRow(actor: Actor, id: string): Promise<{ m: ModelRow; alias: string }> {
    const [row] = await this.deps.db
      .select({ m: modelCatalog, alias: providerConnections.alias })
      .from(modelCatalog)
      .innerJoin(providerConnections, eq(providerConnections.id, modelCatalog.connectionId))
      .where(and(eq(modelCatalog.id, id), eq(providerConnections.organizationId, actor.organizationId)))
      .limit(1);
    if (!row) throw AppError.notFound('Modelo');
    return row;
  }

  async get(actor: Actor, id: string): Promise<CatalogModel> {
    this.readable(actor);
    return (await this.toDtos([await this.findRow(actor, id)]))[0]!;
  }

  private async upsertModel(connectionId: string, provider: string, d: { modelId: string; displayName?: string | null; functions: string[]; entry?: CatalogEntry; discovered?: DiscoveredModel; source: 'provider_api' | 'catalog' | 'manual'; sourceUrl?: string | null }) {
    const e = d.entry;
    const values = {
      connectionId,
      provider,
      modelId: d.modelId,
      displayName: d.displayName ?? e?.name ?? d.discovered?.displayName ?? null,
      family: e?.family ?? null,
      functions: d.functions,
      inputModalities: e?.inputModalities ?? ['text'],
      outputModalities: e?.outputModalities ?? ['text'],
      contextWindow: d.discovered?.contextWindow ?? e?.contextWindow ?? null,
      maxOutputTokens: d.discovered?.maxOutputTokens ?? e?.maxOutputTokens ?? null,
      embeddingDimensions: d.discovered?.embeddingDimensions ?? e?.embeddingDimensions ?? null,
      source: d.source,
      sourceUrl: d.sourceUrl ?? null,
      lastSyncedAt: new Date(),
      raw: (d.discovered?.raw ?? null) as never,
    };
    const [row] = await this.deps.db
      .insert(modelCatalog)
      .values({ ...values, availability: 'unverified' })
      .onConflictDoUpdate({ target: [modelCatalog.connectionId, modelCatalog.modelId], set: values })
      .returning({ id: modelCatalog.id });
    const caps: Record<string, 'yes' | 'no' | 'unknown'> = { ...(e?.capabilities ?? {}) };
    if (provider === 'test' && d.discovered) {
      const isChat = d.functions.includes('chat');
      const toolCapable = d.modelId === 'test-chat';
      Object.assign(caps, { tools: isChat ? (toolCapable ? 'yes' : 'no') : 'no', streaming: isChat ? 'yes' : 'no', structured_output: toolCapable ? 'yes' : 'no', attachments_image: toolCapable ? 'yes' : 'no', temperature: isChat ? 'yes' : 'no' });
    }
    for (const [capability, status] of Object.entries(caps)) {
      await this.deps.db
        .insert(modelCapabilities)
        .values({ modelCatalogId: row!.id, capability, status, source: d.source === 'provider_api' && !e ? 'provider_api' : 'catalog' })
        .onConflictDoUpdate({
          target: [modelCapabilities.modelCatalogId, modelCapabilities.capability],
          // never overwrite a capability verified by an explicit call or set manually
          set: { status: sql`case when ${modelCapabilities.source} in ('verified','manual') then ${modelCapabilities.status} else excluded.status end` },
        });
    }
    return row!.id;
  }

  /**
   * Discovery order: provider API (models visible to this credential) → structured catalog →
   * manual import. Being listed never marks a model as available: that requires `verify`.
   */
  async sync(actor: Actor | null, connectionId: string, organizationId: string) {
    if (actor) assertCan(actor, 'ai.models.manage');
    const [run] = await this.deps.db.insert(priceSyncRuns).values({ kind: 'models', status: 'running', triggeredBy: actor?.userId ?? null }).returning();
    const stats = { discovered: 0, enrichedFromCatalog: 0, catalogOnly: 0 };
    try {
      const { row, client } = await this.connections.client(organizationId, connectionId);
      const provider = row.provider as ProviderKey;
      const catalogKey = PROVIDERS[provider].catalogKey;
      const snapshot = catalogKey ? await loadCatalog(this.deps.env.MODEL_CATALOG_URL) : null;
      let discovered: DiscoveredModel[] | null = null;
      try {
        discovered = await client.listModels(AbortSignal.timeout(20_000));
      } catch (err) {
        const c = classifyAiError(err);
        if (c.kind === 'auth') throw new AppError('UPSTREAM_ERROR', `El proveedor rechazó la credencial: ${c.message}`, { errorKind: c.kind }, { retryable: false });
      }
      if (discovered) {
        for (const d of discovered) {
          const entry = catalogKey ? snapshot?.entries.get(`${catalogKey}:${d.modelId}`) : undefined;
          if (entry) stats.enrichedFromCatalog++;
          await this.upsertModel(connectionId, provider, {
            modelId: d.modelId,
            functions: d.functions ?? entry?.functions ?? guessFunctions(d.modelId),
            entry,
            discovered: d,
            source: 'provider_api',
            sourceUrl: PROVIDERS[provider].defaultBaseUrl ? `${row.baseUrl ?? PROVIDERS[provider].defaultBaseUrl}/models` : row.baseUrl,
          });
          stats.discovered++;
        }
      } else if (snapshot && catalogKey) {
        for (const entry of snapshot.entries.values()) {
          if (entry.provider !== catalogKey) continue;
          await this.upsertModel(connectionId, provider, { modelId: entry.modelId, functions: entry.functions, entry, source: 'catalog', sourceUrl: snapshot.url });
          stats.catalogOnly++;
        }
      }
      await this.deps.db.update(priceSyncRuns).set({ status: 'succeeded', finishedAt: new Date(), stats }).where(eq(priceSyncRuns.id, run!.id));
      if (actor) await recordAudit(this.deps.db, actor, { action: 'ai.models.sync', resourceType: 'provider_connection', resourceId: connectionId, outcome: 'success', metadata: stats });
      return { runId: run!.id, ...stats };
    } catch (err) {
      await this.deps.db.update(priceSyncRuns).set({ status: 'failed', finishedAt: new Date(), stats, error: sanitizeError(err) }).where(eq(priceSyncRuns.id, run!.id));
      throw err;
    }
  }

  async createManual(actor: Actor, input: { connectionId: string; modelId: string; displayName?: string; functions: string[]; inputModalities: string[]; outputModalities: string[]; contextWindow?: number; maxOutputTokens?: number; embeddingDimensions?: number; capabilities: Record<string, 'yes' | 'no' | 'unknown'>; sourceUrl: string }) {
    assertCan(actor, 'ai.models.manage');
    const conn = await this.connections.findRow(actor, input.connectionId);
    const id = await this.upsertModel(conn.id, conn.provider, {
      modelId: input.modelId,
      displayName: input.displayName,
      functions: input.functions,
      entry: {
        provider: conn.provider,
        modelId: input.modelId,
        functions: input.functions,
        inputModalities: input.inputModalities,
        outputModalities: input.outputModalities,
        contextWindow: input.contextWindow,
        maxOutputTokens: input.maxOutputTokens,
        embeddingDimensions: input.embeddingDimensions,
        capabilities: input.capabilities,
      },
      source: 'manual',
      sourceUrl: input.sourceUrl,
    });
    await this.deps.db.update(modelCapabilities).set({ source: 'manual' }).where(eq(modelCapabilities.modelCatalogId, id));
    await recordAudit(this.deps.db, actor, { action: 'ai.models.import', resourceType: 'model', resourceId: id, outcome: 'success', after: input });
    return this.get(actor, id);
  }

  async update(actor: Actor, id: string, input: { enabled?: boolean; capabilities?: Record<string, 'yes' | 'no' | 'unknown'> }) {
    assertCan(actor, 'ai.models.manage');
    const { m } = await this.findRow(actor, id);
    if (input.enabled !== undefined) await this.deps.db.update(modelCatalog).set({ enabled: input.enabled }).where(eq(modelCatalog.id, id));
    for (const [capability, status] of Object.entries(input.capabilities ?? {})) {
      await this.deps.db
        .insert(modelCapabilities)
        .values({ modelCatalogId: id, capability, status, source: 'manual' })
        .onConflictDoUpdate({ target: [modelCapabilities.modelCatalogId, modelCapabilities.capability], set: { status, source: 'manual' } });
    }
    await recordAudit(this.deps.db, actor, { action: 'ai.models.update', resourceType: 'model', resourceId: id, outcome: 'success', before: { enabled: m.enabled }, after: input });
    return this.get(actor, id);
  }

  /** Explicit minimal call; the only way a model becomes "available" for this credential. */
  async verify(actor: Actor, id: string) {
    assertCan(actor, 'ai.models.manage');
    const { m } = await this.findRow(actor, id);
    const { client } = await this.connections.client(actor.organizationId, m.connectionId);
    const aiRequestId = await this.ledger.start({ organizationId: actor.organizationId, userId: actor.userId, feature: 'connection_test', provider: m.provider, connectionId: m.connectionId, modelId: m.modelId });
    const attemptId = await this.ledger.startAttempt(aiRequestId, { provider: m.provider, connectionId: m.connectionId, modelId: m.modelId });
    const t0 = Date.now();
    try {
      let units: Record<string, number> = {};
      let usageKnown = false;
      if (m.functions.includes('embedding')) {
        const model = client.embeddingModel(m.modelId);
        if (!model) throw new AppError('CAPABILITY_UNSUPPORTED', 'El adaptador no soporta embeddings');
        const r = await embed({ model, value: 'ping', maxRetries: 0, abortSignal: AbortSignal.timeout(20_000) });
        units = { embedding_tokens: r.usage?.tokens ?? 1 };
        usageKnown = !!r.usage;
        if (!m.embeddingDimensions || m.embeddingDimensions !== r.embedding.length) {
          await this.deps.db.update(modelCatalog).set({ embeddingDimensions: r.embedding.length }).where(eq(modelCatalog.id, id));
        }
      } else if (m.functions.includes('transcription')) {
        const model = client.transcriptionModel(m.modelId);
        if (!model) throw new AppError('CAPABILITY_UNSUPPORTED', 'El adaptador no soporta transcripción');
        const r = await transcribe({ model, audio: silentWav(), abortSignal: AbortSignal.timeout(30_000) });
        units = { audio_seconds: Math.ceil(r.durationInSeconds ?? 0.5) };
        usageKnown = true;
      } else {
        const r = await generateText({ model: client.languageModel(m.modelId), prompt: 'Responde solo: ok', maxOutputTokens: 16, maxRetries: 0, abortSignal: AbortSignal.timeout(30_000) });
        const u = unitsFromUsage(r.usage as never);
        units = u.units as Record<string, number>;
        usageKnown = u.known;
      }
      const cost = await this.ledger.finishAttempt(attemptId, { status: 'succeeded', units, usageStatus: usageKnown ? 'known' : 'unknown' });
      await this.ledger.finish(aiRequestId, { status: 'succeeded' });
      await this.deps.db.update(modelCatalog).set({ availability: 'available', lastVerifiedAt: new Date() }).where(eq(modelCatalog.id, id));
      if (!m.functions.includes('embedding') && !m.functions.includes('transcription')) {
        await this.deps.db
          .insert(modelCapabilities)
          .values({ modelCatalogId: id, capability: 'streaming', status: 'unknown', source: 'catalog' })
          .onConflictDoNothing();
      }
      return { availability: 'available' as const, latencyMs: Date.now() - t0, errorKind: null, message: 'El modelo respondió correctamente', costUsd: cost.costUsd };
    } catch (err) {
      const c = err instanceof AppError ? { kind: 'invalid_request' as const, message: err.message } : classifyAiError(err);
      await this.ledger.finishAttempt(attemptId, { status: 'failed', usageStatus: 'unknown', billable: false, errorKind: c.kind, error: c.message });
      await this.ledger.finish(aiRequestId, { status: 'failed', errorKind: c.kind, error: c.message });
      const availability = c.kind === 'model_not_found' || c.kind === 'auth' ? 'unavailable' : 'unverified';
      await this.deps.db.update(modelCatalog).set({ availability, lastVerifiedAt: new Date() }).where(eq(modelCatalog.id, id));
      return { availability: availability as 'unavailable' | 'unverified', latencyMs: Date.now() - t0, errorKind: c.kind, message: c.message, costUsd: null };
    }
  }

  /** Capability gate used before execution (agents, lab, RAG). Unknown is treated as unsupported. */
  async capabilities(modelCatalogId: string): Promise<Record<string, 'yes' | 'no' | 'unknown'>> {
    const rows = await this.deps.db.select().from(modelCapabilities).where(eq(modelCapabilities.modelCatalogId, modelCatalogId));
    return Object.fromEntries(rows.map((r) => [r.capability, r.status]));
  }
}
