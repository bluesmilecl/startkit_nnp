import { assertCan, type Actor } from '@starter/auth';
import { agents, aiAttempts, aiRequests, and, count, desc, eq, fxRates, gte, lte, normalizePage, offsetOf, organizations, outerRef, sql, type SQL, toPage, users } from '@starter/db';
import { add, ZERO } from '../money.js';
import type { AiDeps } from './connections.js';

export interface UsageFilter {
  from?: string;
  to?: string;
  groupBy?: 'provider' | 'model' | 'agent' | 'user' | 'feature' | 'organization';
  feature?: string;
}

function range(f: UsageFilter) {
  const to = f.to ? new Date(f.to) : new Date();
  const from = f.from ? new Date(f.from) : new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
}

/** Aggregates derived from the ledger (never from estimates presented as invoices). */
export class UsageService {
  constructor(private readonly deps: AiDeps) {}

  private scope(actor: Actor): SQL {
    // Platform readers may group by organization; everyone else sees only the active organization.
    return actor.platformPermissions.has('ai.usage.read') && this.deps.features.organizations ? sql`true` : eq(aiRequests.organizationId, actor.organizationId);
  }

  async summary(actor: Actor, f: UsageFilter) {
    assertCan(actor, 'ai.usage.read');
    const { from, to } = range(f);
    const where = and(this.scope(actor), gte(aiRequests.startedAt, from), lte(aiRequests.startedAt, to), f.feature ? eq(aiRequests.feature, f.feature) : undefined);
    const db = this.deps.db;
    const [totals] = (
      await db.execute<{
        requests: number;
        cost: string | null;
        calculated: string | null;
        estimated: string | null;
        reconciled: string | null;
        unknown: number;
        input: number;
        output: number;
        errors: number;
        p50: number | null;
        p95: number | null;
      }>(sql`
      select count(*)::int as requests,
        coalesce(sum(cost_usd), 0)::text as cost,
        coalesce(sum(cost_usd) filter (where cost_status = 'calculated'), 0)::text as calculated,
        coalesce(sum(cost_usd) filter (where cost_status = 'estimated'), 0)::text as estimated,
        coalesce(sum(reconciled_cost_usd), 0)::text as reconciled,
        (count(*) filter (where cost_status = 'unknown'))::int as unknown,
        coalesce(sum(input_tokens), 0)::float8 as input,
        coalesce(sum(output_tokens), 0)::float8 as output,
        (count(*) filter (where status = 'failed'))::int as errors,
        percentile_cont(0.5) within group (order by latency_ms) as p50,
        percentile_cont(0.95) within group (order by latency_ms) as p95
      from ${aiRequests} where ${where}`)
    ).rows;
    const daily = (
      await db.execute<{ date: string; cost: string; requests: number; input: number; output: number; errors: number }>(sql`
      select to_char(date_trunc('day', started_at at time zone 'UTC'), 'YYYY-MM-DD') as date,
        coalesce(sum(cost_usd), 0)::text as cost, count(*)::int as requests,
        coalesce(sum(input_tokens), 0)::float8 as input, coalesce(sum(output_tokens), 0)::float8 as output,
        (count(*) filter (where status = 'failed'))::int as errors
      from ${aiRequests} where ${where} group by 1 order by 1`)
    ).rows;
    let cumulative = ZERO;
    const dailyRows = daily.map((d) => {
      cumulative = add(cumulative, d.cost);
      return { date: d.date, costUsd: add(d.cost), cumulativeUsd: cumulative, requests: d.requests, inputTokens: d.input, outputTokens: d.output, errors: d.errors };
    });
    const group = f.groupBy ?? 'model';
    const keyExpr = {
      provider: sql`coalesce(${aiRequests.provider}, 'n/a')`,
      model: sql`coalesce(${aiRequests.provider} || ':' || ${aiRequests.modelId}, 'n/a')`,
      agent: sql`coalesce(${aiRequests.agentId}::text, 'sin agente')`,
      user: sql`coalesce(${aiRequests.userId}::text, 'sistema')`,
      feature: sql`${aiRequests.feature}`,
      organization: sql`${aiRequests.organizationId}::text`,
    }[group];
    const breakdown = (
      await db.execute<{ key: string; requests: number; cost: string; unknown: number; input: number; output: number; errors: number; latency: number | null }>(sql`
      select ${keyExpr} as key, count(*)::int as requests, coalesce(sum(cost_usd), 0)::text as cost,
        (count(*) filter (where cost_status = 'unknown'))::int as unknown,
        coalesce(sum(input_tokens), 0)::float8 as input, coalesce(sum(output_tokens), 0)::float8 as output,
        (count(*) filter (where status = 'failed'))::int as errors, avg(latency_ms)::float8 as latency
      from ${aiRequests} where ${where} group by 1 order by sum(cost_usd) desc nulls last, count(*) desc limit 50`)
    ).rows;
    const labels = await this.labels(group, breakdown.map((b) => b.key));
    let fx: { currency: 'CLP'; rate: string; rateDate: string; source: string } | null = null;
    const [rate] = await db.select().from(fxRates).where(and(eq(fxRates.base, 'USD'), eq(fxRates.quote, 'CLP'))).orderBy(desc(fxRates.rateDate)).limit(1);
    if (rate) fx = { currency: 'CLP', rate: rate.rate, rateDate: rate.rateDate, source: rate.source };
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        requests: totals?.requests ?? 0,
        costUsd: add(totals?.cost ?? '0'),
        calculatedUsd: add(totals?.calculated ?? '0'),
        estimatedUsd: add(totals?.estimated ?? '0'),
        reconciledUsd: add(totals?.reconciled ?? '0'),
        unknownCostRequests: totals?.unknown ?? 0,
        inputTokens: totals?.input ?? 0,
        outputTokens: totals?.output ?? 0,
        errors: totals?.errors ?? 0,
        p50LatencyMs: totals?.p50 ?? null,
        p95LatencyMs: totals?.p95 ?? null,
      },
      daily: dailyRows,
      breakdown: breakdown.map((b) => ({
        key: b.key,
        label: labels.get(b.key) ?? b.key,
        requests: b.requests,
        costUsd: add(b.cost),
        unknownCostRequests: b.unknown,
        inputTokens: b.input,
        outputTokens: b.output,
        errors: b.errors,
        avgLatencyMs: b.latency === null ? null : Math.round(b.latency),
      })),
      fx,
    };
  }

  private async labels(group: string, keys: string[]): Promise<Map<string, string>> {
    const uuids = keys.filter((k) => /^[0-9a-f-]{36}$/.test(k));
    const map = new Map<string, string>();
    if (!uuids.length) return map;
    if (group === 'user') for (const u of await this.deps.db.select({ id: users.id, email: users.email }).from(users).where(sql`${users.id} in ${uuids}`)) map.set(u.id, u.email);
    if (group === 'agent') for (const a of await this.deps.db.select({ id: agents.id, name: agents.name }).from(agents).where(sql`${agents.id} in ${uuids}`)) map.set(a.id, a.name);
    if (group === 'organization') for (const o of await this.deps.db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(sql`${organizations.id} in ${uuids}`)) map.set(o.id, o.name);
    return map;
  }

  async requests(actor: Actor, q: { page?: number; pageSize?: number; feature?: string; status?: string; costStatus?: string }) {
    assertCan(actor, 'ai.usage.read');
    const params = normalizePage(q);
    const where = and(
      this.scope(actor),
      q.feature ? eq(aiRequests.feature, q.feature) : undefined,
      q.status ? eq(aiRequests.status, q.status as 'failed') : undefined,
      q.costStatus ? eq(aiRequests.costStatus, q.costStatus) : undefined,
    );
    const [rows, total] = await Promise.all([
      this.deps.db
        .select({
          r: aiRequests,
          email: users.email,
          attempts: sql<number>`(select count(*)::int from ${aiAttempts} a where a.ai_request_id = ${outerRef(aiRequests.id)})`,
        })
        .from(aiRequests)
        .leftJoin(users, eq(users.id, aiRequests.userId))
        .where(where)
        .orderBy(desc(aiRequests.startedAt))
        .limit(params.pageSize)
        .offset(offsetOf(params)),
      this.deps.db.select({ n: count() }).from(aiRequests).where(where),
    ]);
    return toPage(
      rows.map(({ r, email, attempts }) => ({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        feature: r.feature,
        provider: r.provider,
        modelId: r.modelId,
        status: r.status,
        usageStatus: r.usageStatus,
        costStatus: r.costStatus,
        costUsd: r.costUsd,
        estimatedCostUsd: r.estimatedCostUsd,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        latencyMs: r.latencyMs,
        attempts,
        userEmail: email ?? null,
        agentId: r.agentId,
        conversationId: r.conversationId,
        errorKind: r.errorKind,
        requestId: r.requestId,
      })),
      total[0]?.n ?? 0,
      params,
    );
  }

  /** Last 7 days aggregates for the dashboard. */
  async last7d(organizationId: string) {
    const [r] = (
      await this.deps.db.execute<{ requests: number; cost: string; unknown: number }>(sql`
      select count(*)::int as requests, coalesce(sum(cost_usd), 0)::text as cost, (count(*) filter (where cost_status = 'unknown'))::int as unknown
      from ${aiRequests} where organization_id = ${organizationId} and started_at > now() - interval '7 days'`)
    ).rows;
    return { requests: r?.requests ?? 0, costUsd: add(r?.cost ?? '0'), unknown: r?.unknown ?? 0 };
  }
}

/** Optional CLP display rate from mindicador.cl (Banco Central de Chile "dólar observado"). */
export async function fetchClpRate(): Promise<{ rate: string; rateDate: string; source: string; sourceUrl: string } | null> {
  const url = 'https://mindicador.cl/api/dolar';
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const body = (await res.json()) as { serie?: { fecha: string; valor: number }[] };
  const last = body.serie?.[0];
  if (!last) return null;
  return { rate: last.valor.toFixed(4), rateDate: last.fecha.slice(0, 10), source: 'mindicador.cl (dólar observado, Banco Central de Chile)', sourceUrl: url };
}
