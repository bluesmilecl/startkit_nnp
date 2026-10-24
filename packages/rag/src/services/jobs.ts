import { assertCan, type Actor } from '@starter/auth';
import { AppError } from '@starter/contracts';
import { and, count, desc, eq, inArray, isNull, normalizePage, offsetOf, ragCollections, ragJobs, sql, toPage } from '@starter/db';
import { QUEUES, type QueueName } from '@starter/jobs';
import { add, compare } from '@starter/ai';
import type { RagDeps } from './context.js';

type JobRow = typeof ragJobs.$inferSelect;
export type RagJobKind = 'ingest-source' | 'ingest-document' | 'reindex' | 'delete-document' | 'purge-collection';

const QUEUE: Record<RagJobKind, QueueName> = {
  'ingest-source': QUEUES.ragIngestSource,
  'ingest-document': QUEUES.ragIngestDocument,
  reindex: QUEUES.ragReindex,
  'delete-document': QUEUES.ragDeleteDocument,
  'purge-collection': QUEUES.ragPurge,
};

export class JobCancelledError extends Error {
  constructor() {
    super('Trabajo cancelado');
  }
}

/**
 * Domain view of durable RAG work: pg-boss runs it; this table keeps stage, progress, units,
 * cost, attempts and errors so the panel can show and control it.
 */
export class RagJobsService {
  constructor(private readonly deps: RagDeps) {}

  static toDto(j: JobRow, collectionName: string | null = null) {
    return {
      id: j.id,
      kind: j.kind,
      status: j.status,
      stage: j.stage,
      progressCurrent: j.progressCurrent,
      progressTotal: j.progressTotal,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      collectionId: j.collectionId,
      collectionName,
      sourceId: j.sourceId,
      documentId: j.documentId,
      units: j.units,
      costUsd: j.costUsd,
      budgetUsd: j.budgetUsd,
      error: j.error,
      stageTimings: j.stageTimings,
      createdAt: j.createdAt.toISOString(),
      startedAt: j.startedAt?.toISOString() ?? null,
      finishedAt: j.finishedAt?.toISOString() ?? null,
      heartbeatAt: j.heartbeatAt?.toISOString() ?? null,
    };
  }

  /** Creates the job row and enqueues it; an idempotency key collapses duplicates. */
  async enqueue(input: { organizationId: string; kind: RagJobKind; collectionId?: string | null; sourceId?: string | null; documentId?: string | null; params?: Record<string, unknown>; createdBy?: string | null; idempotencyKey?: string; budgetUsd?: string | null; startAfter?: Date }): Promise<JobRow> {
    if (input.idempotencyKey) {
      const [existing] = await this.deps.db
        .select()
        .from(ragJobs)
        .where(and(sql`${ragJobs.idempotencyKey} like ${`${input.idempotencyKey}:%`}`, inArray(ragJobs.status, ['queued', 'running', 'retrying', 'paused'])))
        .limit(1);
      if (existing) return existing;
    }
    const [row] = await this.deps.db
      .insert(ragJobs)
      .values({
        organizationId: input.organizationId,
        kind: input.kind,
        collectionId: input.collectionId ?? null,
        sourceId: input.sourceId ?? null,
        documentId: input.documentId ?? null,
        params: input.params ?? {},
        createdBy: input.createdBy ?? null,
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:${Date.now()}` : null,
        budgetUsd: input.budgetUsd ?? null,
      })
      .returning();
    if (!this.deps.jobs) throw new Error('Job queue not available in this process');
    const bossId = await this.deps.jobs.send(QUEUE[input.kind], { ragJobId: row!.id }, { startAfter: input.startAfter });
    await this.deps.db.update(ragJobs).set({ bossJobId: bossId }).where(eq(ragJobs.id, row!.id));
    return row!;
  }

  async list(actor: Actor, q: { page?: number; pageSize?: number; status?: string; collectionId?: string; active?: boolean }) {
    assertCan(actor, 'rag.jobs.manage');
    const params = normalizePage(q);
    const where = and(
      eq(ragJobs.organizationId, actor.organizationId),
      q.status ? eq(ragJobs.status, q.status as JobRow['status']) : undefined,
      q.collectionId ? eq(ragJobs.collectionId, q.collectionId) : undefined,
      q.active ? inArray(ragJobs.status, ['queued', 'running', 'retrying', 'paused']) : undefined,
    );
    const [rows, total] = await Promise.all([
      this.deps.db
        .select({ j: ragJobs, name: ragCollections.name })
        .from(ragJobs)
        .leftJoin(ragCollections, eq(ragCollections.id, ragJobs.collectionId))
        .where(where)
        .orderBy(desc(ragJobs.createdAt))
        .limit(params.pageSize)
        .offset(offsetOf(params)),
      this.deps.db.select({ n: count() }).from(ragJobs).where(where),
    ]);
    return toPage(rows.map((r) => RagJobsService.toDto(r.j, r.name)), total[0]?.n ?? 0, params);
  }

  async get(actor: Actor, id: string) {
    assertCan(actor, 'rag.jobs.manage');
    const [r] = await this.deps.db
      .select({ j: ragJobs, name: ragCollections.name })
      .from(ragJobs)
      .leftJoin(ragCollections, eq(ragCollections.id, ragJobs.collectionId))
      .where(and(eq(ragJobs.id, id), eq(ragJobs.organizationId, actor.organizationId)));
    if (!r) throw AppError.notFound('Trabajo');
    return RagJobsService.toDto(r.j, r.name);
  }

  /** Queued jobs are cancelled immediately; running ones stop at the next safe point. */
  async cancel(actor: Actor, id: string) {
    assertCan(actor, 'rag.jobs.manage');
    const [j] = await this.deps.db.select().from(ragJobs).where(and(eq(ragJobs.id, id), eq(ragJobs.organizationId, actor.organizationId)));
    if (!j) throw AppError.notFound('Trabajo');
    if (['succeeded', 'failed', 'cancelled'].includes(j.status)) throw AppError.conflict('El trabajo ya terminó');
    if (j.status === 'queued' || j.status === 'paused') {
      if (j.bossJobId && this.deps.jobs) await this.deps.jobs.cancel(QUEUE[j.kind as RagJobKind], j.bossJobId).catch(() => {});
      await this.deps.db.update(ragJobs).set({ status: 'cancelled', cancelRequestedAt: new Date(), finishedAt: new Date() }).where(eq(ragJobs.id, id));
    } else {
      await this.deps.db.update(ragJobs).set({ cancelRequestedAt: new Date() }).where(eq(ragJobs.id, id));
    }
    return this.get(actor, id);
  }

  async retry(actor: Actor, id: string) {
    assertCan(actor, 'rag.jobs.manage');
    const [j] = await this.deps.db.select().from(ragJobs).where(and(eq(ragJobs.id, id), eq(ragJobs.organizationId, actor.organizationId)));
    if (!j) throw AppError.notFound('Trabajo');
    if (!['failed', 'cancelled'].includes(j.status)) throw AppError.conflict('Solo se reintentan trabajos fallidos o cancelados');
    const created = await this.enqueue({ organizationId: j.organizationId, kind: j.kind as RagJobKind, collectionId: j.collectionId, sourceId: j.sourceId, documentId: j.documentId, params: j.params, createdBy: actor.userId, budgetUsd: j.budgetUsd });
    return this.get(actor, created.id);
  }

  // ── worker-side progress ────────────────────────────────────────────────

  async load(id: string): Promise<JobRow | null> {
    const [j] = await this.deps.db.select().from(ragJobs).where(eq(ragJobs.id, id));
    return j ?? null;
  }

  async start(id: string, attempt: number) {
    await this.deps.db
      .update(ragJobs)
      .set({ status: 'running', attempts: attempt + 1, startedAt: sql`coalesce(${ragJobs.startedAt}, now())`, heartbeatAt: new Date(), error: null })
      .where(eq(ragJobs.id, id));
  }

  async stage(id: string, stage: string, current?: number, total?: number | null) {
    await this.deps.db
      .update(ragJobs)
      .set({
        stage,
        heartbeatAt: new Date(),
        ...(current !== undefined ? { progressCurrent: current } : {}),
        ...(total !== undefined ? { progressTotal: total } : {}),
      })
      .where(eq(ragJobs.id, id));
  }

  async timing(id: string, stage: string, ms: number) {
    await this.deps.db
      .update(ragJobs)
      .set({ stageTimings: sql`${ragJobs.stageTimings} || jsonb_build_object(${stage}::text, coalesce((${ragJobs.stageTimings} ->> ${stage})::int, 0) + ${Math.round(ms)})` })
      .where(eq(ragJobs.id, id));
  }

  /** Accumulates units and cost; throws when the job budget would be exceeded. */
  async addCost(id: string, units: Record<string, number>, costUsd: string | null) {
    const [j] = await this.deps.db.select({ units: ragJobs.units, cost: ragJobs.costUsd, budget: ragJobs.budgetUsd }).from(ragJobs).where(eq(ragJobs.id, id));
    if (!j) return;
    const merged = { ...j.units };
    for (const [k, v] of Object.entries(units)) merged[k] = (merged[k] ?? 0) + v;
    const cost = add(j.cost, costUsd ?? '0');
    await this.deps.db.update(ragJobs).set({ units: merged, costUsd: cost, heartbeatAt: new Date() }).where(eq(ragJobs.id, id));
    if (j.budget && compare(cost, j.budget) > 0) throw new AppError('BUDGET_EXCEEDED', 'El trabajo alcanzó su presupuesto');
  }

  async checkCancelled(id: string) {
    const [j] = await this.deps.db.select({ c: ragJobs.cancelRequestedAt }).from(ragJobs).where(eq(ragJobs.id, id));
    if (j?.c) throw new JobCancelledError();
  }

  async finish(id: string, status: 'succeeded' | 'failed' | 'cancelled', error: string | null = null) {
    await this.deps.db.update(ragJobs).set({ status, error, finishedAt: new Date(), heartbeatAt: new Date() }).where(eq(ragJobs.id, id));
  }

  async markRetrying(id: string, error: string) {
    await this.deps.db.update(ragJobs).set({ status: 'retrying', error }).where(eq(ragJobs.id, id));
  }

  /** Running jobs whose worker stopped heartbeating are shown as such (no silent hangs). */
  async staleRunning(minutes = 15) {
    return this.deps.db
      .select()
      .from(ragJobs)
      .where(and(eq(ragJobs.status, 'running'), sql`${ragJobs.heartbeatAt} < now() - make_interval(mins => ${minutes})`, isNull(ragJobs.finishedAt)));
  }
}
