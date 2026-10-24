import { aiAttempts, aiRequests, and, costSnapshots, eq, sql, usageEvents, type Database } from '@starter/db';
import { currentContext } from '@starter/observability';
import { add, costOf, ZERO } from '../money.js';
import type { PricesService } from './prices.js';

export type Feature = 'chat' | 'recommendation' | 'lab' | 'embedding' | 'rag_query' | 'transcription' | 'tool' | 'connection_test' | 'evaluation' | 'summary' | 'mail_template';

export interface StartRequest {
  organizationId: string;
  feature: Feature;
  userId?: string | null;
  agentId?: string | null;
  agentVersionId?: string | null;
  conversationId?: string | null;
  jobId?: string | null;
  provider?: string | null;
  connectionId?: string | null;
  modelId?: string | null;
  idempotencyKey?: string | null;
  estimatedCostUsd?: string | null;
  metadata?: Record<string, unknown>;
}

/** Units reported by the provider for one attempt (ledger unit names). */
export type Units = Partial<Record<'input_tokens' | 'output_tokens' | 'cached_input_tokens' | 'cache_write_tokens' | 'reasoning_tokens' | 'embedding_tokens' | 'audio_seconds' | 'requests', number>>;

export interface AttemptOutcome {
  status: 'succeeded' | 'failed' | 'cancelled';
  units?: Units | null;
  /** 'known' = reported by the provider; 'estimated' = derived locally (e.g. interrupted stream); 'unknown'. */
  usageStatus: 'known' | 'estimated' | 'unknown';
  billable?: boolean;
  errorKind?: string | null;
  error?: string | null;
}

export interface CostResult {
  costUsd: string | null;
  costStatus: 'calculated' | 'estimated' | 'unknown';
}

/** Units informational only (already included in another billed unit). */
const INFORMATIONAL = new Set(['reasoning_tokens']);

/** AI SDK V4 usage → ledger units. Output total already includes reasoning tokens. */
export function unitsFromUsage(usage: {
  inputTokens?: number | { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens?: number | { total?: number; reasoning?: number };
  inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
} | undefined): { units: Units; known: boolean } {
  if (!usage) return { units: {}, known: false };
  const u: Units = {};
  if (typeof usage.inputTokens === 'object') {
    const it = usage.inputTokens;
    const cacheRead = it.cacheRead ?? 0;
    const cacheWrite = it.cacheWrite ?? 0;
    u.input_tokens = it.noCache ?? Math.max(0, (it.total ?? 0) - cacheRead - cacheWrite);
    if (cacheRead) u.cached_input_tokens = cacheRead;
    if (cacheWrite) u.cache_write_tokens = cacheWrite;
  } else if (typeof usage.inputTokens === 'number') {
    const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
    const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    u.input_tokens = usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
    if (cacheRead) u.cached_input_tokens = cacheRead;
    if (cacheWrite) u.cache_write_tokens = cacheWrite;
  }
  if (typeof usage.outputTokens === 'object') {
    u.output_tokens = usage.outputTokens.total ?? 0;
    if (usage.outputTokens.reasoning) u.reasoning_tokens = usage.outputTokens.reasoning;
  } else if (typeof usage.outputTokens === 'number') {
    u.output_tokens = usage.outputTokens;
    const r = usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens;
    if (r) u.reasoning_tokens = r;
  }
  const known = u.input_tokens !== undefined || u.output_tokens !== undefined;
  return { units: u, known };
}

/**
 * Append-only ledger of AI consumption: one ai_request per logical execution, one ai_attempt per
 * real provider call (retries and fallbacks included) and usage_events per billed unit with a
 * copy of the tariff applied. Estimates and unknown costs are explicit; never "0 by default".
 */
export class UsageLedger {
  constructor(
    private readonly db: Database,
    private readonly prices: PricesService,
  ) {}

  async start(r: StartRequest): Promise<string> {
    if (r.idempotencyKey) {
      const [existing] = await this.db.select({ id: aiRequests.id }).from(aiRequests).where(eq(aiRequests.idempotencyKey, r.idempotencyKey)).limit(1);
      if (existing) return existing.id;
    }
    const [row] = await this.db
      .insert(aiRequests)
      .values({
        requestId: currentContext()?.requestId ?? null,
        idempotencyKey: r.idempotencyKey ?? null,
        organizationId: r.organizationId,
        userId: r.userId ?? null,
        agentId: r.agentId ?? null,
        agentVersionId: r.agentVersionId ?? null,
        conversationId: r.conversationId ?? null,
        jobId: r.jobId ?? null,
        feature: r.feature,
        provider: r.provider ?? null,
        connectionId: r.connectionId ?? null,
        modelId: r.modelId ?? null,
        estimatedCostUsd: r.estimatedCostUsd ?? null,
        metadata: r.metadata ?? null,
      })
      .onConflictDoNothing({ target: aiRequests.idempotencyKey })
      .returning({ id: aiRequests.id });
    if (row) return row.id;
    const [again] = await this.db.select({ id: aiRequests.id }).from(aiRequests).where(eq(aiRequests.idempotencyKey, r.idempotencyKey!));
    return again!.id;
  }

  async startAttempt(aiRequestId: string, a: { provider: string; connectionId: string | null; modelId: string }): Promise<string> {
    const [{ n }] = (await this.db.execute<{ n: number }>(sql`select coalesce(max(attempt_no), 0)::int + 1 as n from ${aiAttempts} where ai_request_id = ${aiRequestId}`)).rows as [{ n: number }];
    const [row] = await this.db
      .insert(aiAttempts)
      .values({ aiRequestId, attemptNo: n, provider: a.provider, connectionId: a.connectionId, modelId: a.modelId, status: 'running' })
      .returning({ id: aiAttempts.id });
    return row!.id;
  }

  /** Attempts of a request still marked as running (used before aggregating a request). */
  async runningAttempts(aiRequestId: string): Promise<string[]> {
    const rows = await this.db.select({ id: aiAttempts.id }).from(aiAttempts).where(and(eq(aiAttempts.aiRequestId, aiRequestId), eq(aiAttempts.status, 'running')));
    return rows.map((r) => r.id);
  }

  /** Prices the attempt's units with a persisted snapshot of the applied tariffs. */
  async finishAttempt(attemptId: string, o: AttemptOutcome): Promise<CostResult> {
    const [attempt] = await this.db.select().from(aiAttempts).where(eq(aiAttempts.id, attemptId));
    if (!attempt) throw new Error('attempt not found');
    const [req] = await this.db.select({ organizationId: aiRequests.organizationId }).from(aiRequests).where(eq(aiRequests.id, attempt.aiRequestId));
    let cost: CostResult = { costUsd: null, costStatus: 'unknown' };
    const billable = o.billable ?? true;
    const units = o.units ?? {};
    if (billable && o.usageStatus !== 'unknown' && Object.keys(units).length) {
      const prices = await this.prices.current(attempt.provider, attempt.modelId, attempt.connectionId, attempt.startedAt);
      const byUnit = new Map(prices.map((p) => [p.unit, p]));
      const [snapshot] = await this.db.insert(costSnapshots).values({ prices }).returning({ id: costSnapshots.id });
      let total = ZERO;
      let anyUnknown = false;
      let assumed = false;
      for (const [unit, quantity] of Object.entries(units)) {
        if (!quantity && quantity !== 0) continue;
        let price = byUnit.get(unit);
        if (!price && unit === 'cached_input_tokens' && byUnit.get('input_tokens')) {
          // Cached tokens without a published cached tariff are priced at the input tariff: estimate.
          price = byUnit.get('input_tokens');
          assumed = true;
        }
        const informational = INFORMATIONAL.has(unit);
        const lineCost = price && !informational ? costOf(quantity, price.price, price.unitQuantity) : null;
        if (!price && !informational) anyUnknown = true;
        if (lineCost) total = add(total, lineCost);
        await this.db
          .insert(usageEvents)
          .values({
            aiRequestId: attempt.aiRequestId,
            aiAttemptId: attempt.id,
            organizationId: req!.organizationId,
            unit,
            quantity: Math.round(quantity),
            costUsd: informational ? null : lineCost,
            costStatus: informational ? 'informational' : lineCost ? 'calculated' : 'unknown',
            priceId: price?.priceId ?? null,
            snapshotId: snapshot!.id,
            idempotencyKey: `${attempt.id}:${unit}`,
          })
          .onConflictDoNothing({ target: usageEvents.idempotencyKey });
      }
      cost = anyUnknown
        ? { costUsd: null, costStatus: 'unknown' }
        : { costUsd: total, costStatus: assumed || o.usageStatus === 'estimated' ? 'estimated' : 'calculated' };
    } else if (!billable) {
      cost = { costUsd: ZERO, costStatus: 'calculated' };
    }
    await this.db
      .update(aiAttempts)
      .set({
        status: o.status,
        finishedAt: new Date(),
        units,
        usageStatus: o.usageStatus,
        billable,
        costUsd: cost.costUsd,
        costStatus: cost.costStatus,
        errorKind: o.errorKind ?? null,
        error: o.error ?? null,
      })
      .where(eq(aiAttempts.id, attemptId));
    return cost;
  }

  /** Aggregates attempts into the logical request. */
  async finish(aiRequestId: string, f: { status: 'succeeded' | 'failed' | 'cancelled'; firstTokenAt?: Date | null; errorKind?: string | null; error?: string | null; metadata?: Record<string, unknown> }) {
    const attempts = await this.db.select().from(aiAttempts).where(eq(aiAttempts.aiRequestId, aiRequestId));
    const [req] = await this.db.select().from(aiRequests).where(eq(aiRequests.id, aiRequestId));
    let total = ZERO;
    let status: CostResult['costStatus'] = 'calculated';
    let usageStatus: 'known' | 'pending' | 'unknown' = attempts.length ? 'known' : 'unknown';
    const sum = { input: 0, output: 0, cached: 0, reasoning: 0 };
    const other: Record<string, number> = {};
    for (const a of attempts) {
      const u = (a.units ?? {}) as Units;
      sum.input += u.input_tokens ?? 0;
      sum.output += u.output_tokens ?? 0;
      sum.cached += u.cached_input_tokens ?? 0;
      sum.reasoning += u.reasoning_tokens ?? 0;
      for (const k of ['embedding_tokens', 'audio_seconds', 'requests'] as const) if (u[k]) other[k] = (other[k] ?? 0) + u[k]!;
      if (a.usageStatus === 'unknown' && a.billable) usageStatus = 'unknown';
      else if (a.usageStatus === 'estimated' && usageStatus === 'known') usageStatus = 'pending';
      if (a.costStatus === 'unknown' && a.billable) status = 'unknown';
      else if (a.costStatus === 'estimated' && status === 'calculated') status = 'estimated';
      if (a.costUsd) total = add(total, a.costUsd);
    }
    const finishedAt = new Date();
    await this.db
      .update(aiRequests)
      .set({
        status: f.status,
        finishedAt,
        firstTokenAt: f.firstTokenAt ?? null,
        latencyMs: req ? finishedAt.getTime() - req.startedAt.getTime() : null,
        usageStatus,
        costStatus: status,
        costUsd: status === 'unknown' ? null : total,
        inputTokens: sum.input || null,
        outputTokens: sum.output || null,
        cachedInputTokens: sum.cached || null,
        reasoningTokens: sum.reasoning || null,
        otherUnits: Object.keys(other).length ? other : null,
        errorKind: f.errorKind ?? null,
        error: f.error ?? null,
        metadata: f.metadata ? { ...((req?.metadata as object) ?? {}), ...f.metadata } : req?.metadata,
      })
      .where(eq(aiRequests.id, aiRequestId));
    return { costUsd: status === 'unknown' ? null : total, costStatus: status };
  }

  /** Records a provider-reconciled amount (invoice/usage API). Never overwrites the calculated cost. */
  async reconcile(aiRequestId: string, amountUsd: string): Promise<void> {
    await this.db.update(aiRequests).set({ reconciledCostUsd: amountUsd, costStatus: 'reconciled' }).where(and(eq(aiRequests.id, aiRequestId)));
  }
}
