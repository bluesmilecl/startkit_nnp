import { assertCan, recordAudit, type Actor } from '@starter/auth';
import { AppError, type LabRunInput } from '@starter/contracts';
import { and, desc, eq, labRuns } from '@starter/db';
import { streamText } from 'ai';
import { classifyAiError } from '../errors.js';
import { add, compare, ZERO } from '../money.js';
import type { AiDeps } from './connections.js';
import { unitsFromUsage } from './ledger.js';
import type { AiRuntime } from './runtime.js';

type RunRow = typeof labRuns.$inferSelect;

export interface LabResultRow {
  modelCatalogId: string;
  modelId: string;
  promptIndex: number;
  text: string | null;
  error: string | null;
  errorKind: string | null;
  latencyMs: number | null;
  timeToFirstTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  costStatus: string;
  skipped: boolean;
}

/**
 * Runs the same prompt set against several models under a run budget and a concurrency cap.
 * Executed by the worker (durable job); every call, including the evaluator, is in the ledger.
 */
export class LabService {
  constructor(
    private readonly deps: AiDeps,
    private readonly runtime: AiRuntime,
  ) {}

  static toDto(r: RunRow) {
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      input: r.input,
      budgetUsd: r.budgetUsd,
      spentUsd: r.spentUsd,
      results: (r.kind === 'comparison' ? (r.results as LabResultRow[] | null) : null) ?? null,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    };
  }

  async create(actor: Actor, input: LabRunInput): Promise<RunRow> {
    assertCan(actor, 'ai.lab.use');
    for (const id of input.modelCatalogIds) await this.runtime.resolve(actor.organizationId, id);
    const [run] = await this.deps.db
      .insert(labRuns)
      .values({ organizationId: actor.organizationId, createdBy: actor.userId, kind: 'comparison', input, status: 'queued', budgetUsd: input.budgetUsd, spentUsd: ZERO })
      .returning();
    await recordAudit(this.deps.db, actor, { action: 'ai.lab.create', resourceType: 'lab_run', resourceId: run!.id, outcome: 'success', metadata: { models: input.modelCatalogIds.length, prompts: input.prompts.length, budgetUsd: input.budgetUsd } });
    return run!;
  }

  async list(actor: Actor) {
    assertCan(actor, 'ai.lab.use');
    const rows = await this.deps.db
      .select()
      .from(labRuns)
      .where(and(eq(labRuns.organizationId, actor.organizationId), eq(labRuns.kind, 'comparison')))
      .orderBy(desc(labRuns.createdAt))
      .limit(20);
    return rows.map(LabService.toDto);
  }

  async get(actor: Actor, id: string) {
    assertCan(actor, 'ai.lab.use');
    const [row] = await this.deps.db.select().from(labRuns).where(and(eq(labRuns.id, id), eq(labRuns.organizationId, actor.organizationId)));
    if (!row) throw AppError.notFound('Ejecución', 'f');
    return LabService.toDto(row);
  }

  /** Worker entry point. */
  async execute(runId: string, signal?: AbortSignal): Promise<void> {
    const [run] = await this.deps.db.select().from(labRuns).where(eq(labRuns.id, runId));
    if (!run || run.status === 'succeeded' || run.status === 'cancelled') return;
    await this.deps.db.update(labRuns).set({ status: 'running' }).where(eq(labRuns.id, runId));
    const input = run.input as LabRunInput;
    const tasks = input.modelCatalogIds.flatMap((m) => input.prompts.map((_, i) => ({ modelCatalogId: m, promptIndex: i })));
    const results: LabResultRow[] = [];
    let spent = ZERO;
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++]!;
        results.push(await this.runOne(run, input, task, () => spent, (c) => (spent = add(spent, c)), signal));
        await this.deps.db.update(labRuns).set({ results, spentUsd: spent }).where(eq(labRuns.id, runId));
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(input.concurrency, tasks.length) }, worker));
      results.sort((a, b) => a.modelCatalogId.localeCompare(b.modelCatalogId) || a.promptIndex - b.promptIndex);
      await this.deps.db.update(labRuns).set({ status: 'succeeded', results, spentUsd: spent, finishedAt: new Date() }).where(eq(labRuns.id, runId));
    } catch (err) {
      await this.deps.db.update(labRuns).set({ status: 'failed', error: (err as Error).message, results, spentUsd: spent, finishedAt: new Date() }).where(eq(labRuns.id, runId));
    }
  }

  private async runOne(
    run: RunRow,
    input: LabRunInput,
    task: { modelCatalogId: string; promptIndex: number },
    getSpent: () => string,
    addSpent: (c: string) => void,
    signal?: AbortSignal,
  ): Promise<LabResultRow> {
    const model = await this.runtime.resolve(run.organizationId, task.modelCatalogId);
    const base: LabResultRow = { modelCatalogId: task.modelCatalogId, modelId: model.modelId, promptIndex: task.promptIndex, text: null, error: null, errorKind: null, latencyMs: null, timeToFirstTokenMs: null, inputTokens: null, outputTokens: null, costUsd: null, costStatus: 'unknown', skipped: false };
    const prompt = input.prompts[task.promptIndex]!;
    const estimate = await this.runtime.estimate(model, { input_tokens: Math.ceil(((input.system?.length ?? 0) + prompt.length) / 3.5), output_tokens: input.maxOutputTokens });
    if (estimate === null) return { ...base, skipped: true, error: 'Tarifa desconocida: no se puede respetar el presupuesto del laboratorio' };
    if (compare(add(getSpent(), estimate), run.budgetUsd ?? '0') > 0) return { ...base, skipped: true, error: 'Presupuesto del laboratorio agotado' };
    const ledger = this.runtime.ledger;
    const aiRequestId = await ledger.start({ organizationId: run.organizationId, userId: run.createdBy, feature: 'lab', provider: model.provider, connectionId: model.connectionId, modelId: model.modelId, estimatedCostUsd: estimate, metadata: { labRunId: run.id } });
    let reservation: string | null;
    try {
      reservation = await this.runtime.reserve({ organizationId: run.organizationId, userId: run.createdBy, feature: 'lab' }, estimate, aiRequestId);
    } catch (err) {
      await ledger.finish(aiRequestId, { status: 'failed', errorKind: 'budget', error: (err as Error).message });
      return { ...base, skipped: true, error: (err as Error).message };
    }
    const attemptId = await ledger.startAttempt(aiRequestId, { provider: model.provider, connectionId: model.connectionId, modelId: model.modelId });
    const t0 = Date.now();
    let ttft: number | null = null;
    let text = '';
    try {
      const lm = await this.runtime.languageModel(model);
      const result = streamText({ model: lm, system: input.system, prompt, maxOutputTokens: input.maxOutputTokens, maxRetries: 0, abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
      for await (const delta of result.textStream) {
        if (ttft === null) ttft = Date.now() - t0;
        text += delta;
      }
      const u = unitsFromUsage((await result.totalUsage) as never);
      await ledger.finishAttempt(attemptId, { status: 'succeeded', units: u.units, usageStatus: u.known ? 'known' : 'unknown' });
      const cost = await ledger.finish(aiRequestId, { status: 'succeeded', firstTokenAt: ttft !== null ? new Date(t0 + ttft) : null });
      await this.runtime.budgetsService.settle(reservation, cost.costUsd);
      addSpent(cost.costUsd ?? estimate);
      return { ...base, text, latencyMs: Date.now() - t0, timeToFirstTokenMs: ttft, inputTokens: u.units.input_tokens ?? null, outputTokens: u.units.output_tokens ?? null, costUsd: cost.costUsd, costStatus: cost.costStatus };
    } catch (err) {
      const c = classifyAiError(err);
      await ledger.finishAttempt(attemptId, { status: 'failed', usageStatus: 'unknown', billable: !!text, errorKind: c.kind, error: c.message });
      const cost = await ledger.finish(aiRequestId, { status: 'failed', errorKind: c.kind, error: c.message });
      if (cost.costStatus === 'unknown' && text) {
        await this.runtime.budgetsService.settle(reservation, null);
        addSpent(estimate);
      } else await this.runtime.budgetsService.release(reservation);
      return { ...base, text: text || null, error: c.message, errorKind: c.kind, latencyMs: Date.now() - t0, timeToFirstTokenMs: ttft, costStatus: cost.costStatus };
    }
  }
}
