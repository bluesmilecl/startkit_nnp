import { assertCan, recordAudit, type Actor } from '@starter/auth';
import { AppError, type CreatePriceInput, type PriceRow } from '@starter/contracts';
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  modelPrices,
  normalizePage,
  offsetOf,
  or,
  priceSources,
  priceSyncRuns,
  providerConnections,
  sql,
  toPage,
  type DbOrTx,
} from '@starter/db';
import { sanitizeError } from '@starter/observability';
import { loadCatalog } from '../catalog-source.js';
import { compare, toUnits, fromUnits } from '../money.js';
import { PROVIDERS, type ProviderKey } from '../providers/registry.js';
import { TEST_PRICES } from '../providers/test-provider.js';
import type { AiDeps } from './connections.js';

type PriceDbRow = typeof modelPrices.$inferSelect;

export interface PriceCandidate {
  unit: string;
  price: string;
  unitQuantity: number;
  priceId: string;
  sourceUrl: string | null;
}

/** Decimal number from the catalog (USD per 1M) to a fixed decimal string. */
function dec(n: number): string {
  return fromUnits(toUnits(n.toFixed(12)));
}

export class PricesService {
  constructor(private readonly deps: AiDeps) {}

  private async sourceRow(key: string, name: string, kind: string, url: string | null, db: DbOrTx = this.deps.db) {
    const [row] = await db
      .insert(priceSources)
      .values({ key, name, kind, url })
      .onConflictDoUpdate({ target: priceSources.key, set: { name, kind, url } })
      .returning();
    return row!;
  }

  static toDto(r: PriceDbRow, source?: { kind: string; name: string; url: string | null } | null): PriceRow {
    return {
      id: r.id,
      provider: r.provider,
      modelId: r.modelId,
      connectionId: r.connectionId,
      billingScope: r.billingScope as PriceRow['billingScope'],
      serviceTier: r.serviceTier,
      unit: r.unit,
      unitQuantity: r.unitQuantity,
      price: r.price,
      currency: r.currency,
      modality: r.modality,
      source: { kind: source?.kind ?? 'unknown', name: source?.name ?? 'desconocida', url: r.sourceUrl ?? source?.url ?? null },
      fetchedAt: r.fetchedAt.toISOString(),
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
    };
  }

  async list(actor: Actor, q: { page?: number; pageSize?: number; provider?: string; modelId?: string; includeHistory?: boolean }) {
    if (!actor.permissions.has('ai.models.manage') && !actor.permissions.has('ai.usage.read')) assertCan(actor, 'ai.models.manage');
    const params = normalizePage(q, 200);
    const where = and(
      q.provider ? eq(modelPrices.provider, q.provider) : undefined,
      q.modelId ? eq(modelPrices.modelId, q.modelId) : undefined,
      q.includeHistory ? undefined : isNull(modelPrices.effectiveTo),
      or(isNull(modelPrices.connectionId), sql`${modelPrices.connectionId} in (select id from ${providerConnections} where organization_id = ${actor.organizationId})`),
    );
    const [rows, total] = await Promise.all([
      this.deps.db
        .select({ p: modelPrices, s: priceSources })
        .from(modelPrices)
        .leftJoin(priceSources, eq(priceSources.id, modelPrices.sourceId))
        .where(where)
        .orderBy(modelPrices.provider, modelPrices.modelId, modelPrices.unit, desc(modelPrices.effectiveFrom))
        .limit(params.pageSize)
        .offset(offsetOf(params)),
      this.deps.db.select({ n: count() }).from(modelPrices).where(where),
    ]);
    return toPage(
      rows.map((r) => PricesService.toDto(r.p, r.s)),
      total[0]?.n ?? 0,
      params,
    );
  }

  /** Current tariffs for a model (connection-specific prices override provider-wide ones). */
  async current(provider: string, modelId: string, connectionId: string | null, at = new Date(), db: DbOrTx = this.deps.db): Promise<PriceCandidate[]> {
    const rows = await db
      .select()
      .from(modelPrices)
      .where(
        and(
          eq(modelPrices.provider, provider),
          eq(modelPrices.modelId, modelId),
          lte(modelPrices.effectiveFrom, at),
          or(isNull(modelPrices.effectiveTo), gte(modelPrices.effectiveTo, at)),
          connectionId ? or(isNull(modelPrices.connectionId), eq(modelPrices.connectionId, connectionId)) : isNull(modelPrices.connectionId),
          isNull(modelPrices.serviceTier),
        ),
      )
      .orderBy(desc(modelPrices.effectiveFrom));
    const byUnit = new Map<string, PriceDbRow>();
    for (const r of rows) {
      const existing = byUnit.get(r.unit);
      // connection-specific (custom agreement) wins over provider-wide prices
      if (!existing || (r.connectionId && !existing.connectionId)) byUnit.set(r.unit, r);
    }
    return [...byUnit.values()].map((r) => ({ unit: r.unit, price: r.price, unitQuantity: r.unitQuantity, priceId: r.id, sourceUrl: r.sourceUrl }));
  }

  async currentForMany(keys: { provider: string; modelId: string; connectionId: string | null }[]): Promise<Map<string, PriceCandidate[]>> {
    const out = new Map<string, PriceCandidate[]>();
    const models = [...new Set(keys.map((k) => k.modelId))];
    if (!models.length) return out;
    const rows = await this.deps.db
      .select()
      .from(modelPrices)
      .where(and(inArray(modelPrices.modelId, models), isNull(modelPrices.effectiveTo), isNull(modelPrices.serviceTier)));
    for (const k of keys) {
      const byUnit = new Map<string, PriceDbRow>();
      for (const r of rows) {
        if (r.provider !== k.provider || r.modelId !== k.modelId) continue;
        if (r.connectionId && r.connectionId !== k.connectionId) continue;
        const ex = byUnit.get(r.unit);
        if (!ex || (r.connectionId && !ex.connectionId)) byUnit.set(r.unit, r);
      }
      out.set(`${k.provider}:${k.modelId}:${k.connectionId ?? ''}`, [...byUnit.values()].map((r) => ({ unit: r.unit, price: r.price, unitQuantity: r.unitQuantity, priceId: r.id, sourceUrl: r.sourceUrl })));
    }
    return out;
  }

  /** Current tariff rows (with source) for several models, for catalog listings. */
  async currentDtosForMany(keys: { provider: string; modelId: string; connectionId: string | null }[]): Promise<Map<string, PriceRow[]>> {
    const out = new Map<string, PriceRow[]>();
    const models = [...new Set(keys.map((k) => k.modelId))];
    if (!models.length) return out;
    const rows = await this.deps.db
      .select({ p: modelPrices, s: priceSources })
      .from(modelPrices)
      .leftJoin(priceSources, eq(priceSources.id, modelPrices.sourceId))
      .where(and(inArray(modelPrices.modelId, models), isNull(modelPrices.effectiveTo)));
    for (const k of keys) {
      const list = rows
        .filter((r) => r.p.provider === k.provider && r.p.modelId === k.modelId && (!r.p.connectionId || r.p.connectionId === k.connectionId))
        .map((r) => PricesService.toDto(r.p, r.s));
      out.set(`${k.provider}:${k.modelId}:${k.connectionId ?? ''}`, list);
    }
    return out;
  }

  /**
   * Inserts a tariff version. If an identical active price exists nothing changes; otherwise the
   * previous version is closed (effective_to) and a new row starts — history is never rewritten.
   */
  async upsertVersion(
    v: { provider: string; modelId: string; connectionId: string | null; billingScope: string; serviceTier: string | null; unit: string; unitQuantity: number; price: string; sourceId: string; sourceUrl: string | null; fetchedAt: Date; createdBy?: string | null; effectiveFrom?: Date },
    db: DbOrTx = this.deps.db,
  ): Promise<'unchanged' | 'created' | 'updated'> {
    const [active] = await db
      .select()
      .from(modelPrices)
      .where(
        and(
          eq(modelPrices.provider, v.provider),
          eq(modelPrices.modelId, v.modelId),
          eq(modelPrices.unit, v.unit),
          eq(modelPrices.billingScope, v.billingScope),
          v.connectionId ? eq(modelPrices.connectionId, v.connectionId) : isNull(modelPrices.connectionId),
          v.serviceTier ? eq(modelPrices.serviceTier, v.serviceTier) : isNull(modelPrices.serviceTier),
          isNull(modelPrices.effectiveTo),
        ),
      )
      .limit(1);
    const now = v.effectiveFrom ?? new Date();
    if (active && compare(active.price, v.price) === 0 && active.unitQuantity === v.unitQuantity) {
      await db.update(modelPrices).set({ fetchedAt: v.fetchedAt }).where(eq(modelPrices.id, active.id));
      return 'unchanged';
    }
    if (active) await db.update(modelPrices).set({ effectiveTo: now }).where(eq(modelPrices.id, active.id));
    await db.insert(modelPrices).values({
      provider: v.provider,
      modelId: v.modelId,
      connectionId: v.connectionId,
      billingScope: v.billingScope,
      serviceTier: v.serviceTier,
      unit: v.unit,
      unitQuantity: v.unitQuantity,
      price: v.price,
      sourceId: v.sourceId,
      sourceUrl: v.sourceUrl,
      fetchedAt: v.fetchedAt,
      effectiveFrom: now,
      createdBy: v.createdBy ?? null,
    });
    return active ? 'updated' : 'created';
  }

  /** Manual tariff or custom agreement with its source. */
  async create(actor: Actor, input: CreatePriceInput) {
    assertCan(actor, 'ai.models.manage');
    if (input.connectionId) {
      const [c] = await this.deps.db
        .select({ id: providerConnections.id })
        .from(providerConnections)
        .where(and(eq(providerConnections.id, input.connectionId), eq(providerConnections.organizationId, actor.organizationId)));
      if (!c) throw AppError.notFound('Conexión');
    }
    const source = await this.sourceRow(`manual:${actor.organizationId}`, input.sourceName || 'Manual', input.connectionId ? 'agreement' : 'manual', null);
    const result = await this.deps.db.transaction(async (tx) => {
      const r = await this.upsertVersion(
        {
          provider: input.provider,
          modelId: input.modelId,
          connectionId: input.connectionId ?? null,
          billingScope: input.billingScope,
          serviceTier: input.serviceTier ?? null,
          unit: input.unit,
          unitQuantity: input.unitQuantity,
          price: fromUnits(toUnits(input.price)),
          sourceId: source.id,
          sourceUrl: input.sourceUrl ?? null,
          fetchedAt: new Date(),
          createdBy: actor.userId,
          effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : undefined,
        },
        tx,
      );
      await recordAudit(tx, actor, { action: 'ai.prices.set', resourceType: 'model_price', resourceId: `${input.provider}:${input.modelId}:${input.unit}`, outcome: 'success', after: { ...input, result: r } });
      return r;
    });
    return { result };
  }

  /** Syncs tariffs from the structured catalog (and test fixtures when enabled). */
  async syncFromCatalog(triggeredBy: string | null): Promise<{ runId: string; created: number; updated: number; unchanged: number; skipped: number }> {
    const [run] = await this.deps.db.insert(priceSyncRuns).values({ kind: 'prices', status: 'running', triggeredBy }).returning();
    const stats = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
    try {
      const fetchedAt = new Date();
      const url = this.deps.env.MODEL_CATALOG_URL;
      const providerKeys = (await this.deps.db.selectDistinct({ provider: providerConnections.provider }).from(providerConnections)).map((r) => r.provider as ProviderKey);
      if (this.deps.env.AI_TEST_PROVIDER_ENABLED) {
        const src = await this.sourceRow('test-fixture', 'Tarifas sintéticas del proveedor de prueba', 'catalog', null);
        for (const p of TEST_PRICES) {
          const r = await this.upsertVersion({ provider: 'test', modelId: p.modelId, connectionId: null, billingScope: 'direct', serviceTier: null, unit: p.unit, unitQuantity: p.unitQuantity, price: fromUnits(toUnits(p.price)), sourceId: src.id, sourceUrl: null, fetchedAt });
          stats[r]++;
        }
      }
      const catalogProviders = providerKeys.map((k) => PROVIDERS[k]?.catalogKey).filter((k): k is string => !!k);
      if (catalogProviders.length) {
        const snapshot = await loadCatalog(url, true);
        if (!snapshot) throw new Error(`Catálogo estructurado no disponible (${url})`);
        const src = await this.sourceRow('models.dev', 'models.dev (catálogo estructurado)', 'catalog', url);
        for (const entry of snapshot.entries.values()) {
          const provider = providerKeys.find((k) => PROVIDERS[k].catalogKey === entry.provider);
          if (!provider || !entry.cost) continue;
          const units: [string, number | undefined][] = entry.functions.includes('embedding')
            ? [['embedding_tokens', entry.cost.input]]
            : [
                ['input_tokens', entry.cost.input],
                ['output_tokens', entry.cost.output],
                ['cached_input_tokens', entry.cost.cacheRead],
                ['cache_write_tokens', entry.cost.cacheWrite],
                ['audio_input_tokens', entry.cost.inputAudio],
              ];
          for (const [unit, value] of units) {
            if (value === undefined || value === null || !Number.isFinite(value)) {
              stats.skipped++;
              continue;
            }
            const r = await this.upsertVersion({
              provider,
              modelId: entry.modelId,
              connectionId: null,
              billingScope: 'direct',
              serviceTier: null,
              unit,
              unitQuantity: 1_000_000,
              price: dec(value),
              sourceId: src.id,
              sourceUrl: `https://models.dev/?search=${encodeURIComponent(entry.modelId)}`,
              fetchedAt,
            });
            stats[r]++;
          }
        }
        await this.deps.db.update(priceSources).set({ lastFetchedAt: fetchedAt }).where(eq(priceSources.id, src.id));
      }
      await this.deps.db.update(priceSyncRuns).set({ status: 'succeeded', finishedAt: new Date(), stats }).where(eq(priceSyncRuns.id, run!.id));
      return { runId: run!.id, ...stats };
    } catch (err) {
      await this.deps.db
        .update(priceSyncRuns)
        .set({ status: 'failed', finishedAt: new Date(), stats, error: sanitizeError(err) })
        .where(eq(priceSyncRuns.id, run!.id));
      throw err;
    }
  }

  async runs(actor: Actor, kind?: 'prices' | 'models') {
    if (!actor.permissions.has('ai.models.manage') && !actor.permissions.has('ai.providers.manage')) assertCan(actor, 'ai.models.manage');
    const rows = await this.deps.db
      .select()
      .from(priceSyncRuns)
      .where(kind ? eq(priceSyncRuns.kind, kind) : undefined)
      .orderBy(desc(priceSyncRuns.startedAt))
      .limit(20);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      stats: (r.stats as Record<string, unknown>) ?? null,
      error: r.error,
    }));
  }
}
