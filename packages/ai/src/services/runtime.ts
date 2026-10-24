import type { EmbeddingModelV4, LanguageModelV4, TranscriptionModelV4 } from '@ai-sdk/provider';
import { AppError } from '@starter/contracts';
import { and, eq, modelCatalog, providerConnections } from '@starter/db';
import { embedMany, experimental_transcribe as transcribe, generateText, Output, type ModelMessage } from 'ai';
import type { z } from 'zod';
import { classifyAiError } from '../errors.js';
import { add, costOf, ZERO } from '../money.js';
import type { BudgetScope, BudgetsService } from './budgets.js';
import type { AiDeps, ConnectionsService } from './connections.js';
import { unitsFromUsage, type Feature, type UsageLedger } from './ledger.js';
import type { PricesService } from './prices.js';

export interface ResolvedModel {
  modelCatalogId: string;
  provider: string;
  connectionId: string;
  modelId: string;
  functions: string[];
  contextWindow: number | null;
  maxOutputTokens: number | null;
  embeddingDimensions: number | null;
}

export interface CallContext {
  organizationId: string;
  userId?: string | null;
  agentId?: string | null;
  agentVersionId?: string | null;
  conversationId?: string | null;
  jobId?: string | null;
  feature: Feature;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RetryPolicy {
  retries: number;
  fallbackModelCatalogIds: string[];
  timeoutMs: number;
}

const DEFAULT_RETRY: RetryPolicy = { retries: 1, fallbackModelCatalogIds: [], timeoutMs: 60_000 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const estimateTokens = (chars: number) => Math.ceil(chars / 3.5);

export class AiRuntime {
  constructor(
    private readonly deps: AiDeps,
    private readonly connections: ConnectionsService,
    private readonly prices: PricesService,
    readonly ledger: UsageLedger,
    private readonly budgets: BudgetsService,
  ) {}

  async resolve(organizationId: string, modelCatalogId: string): Promise<ResolvedModel> {
    const [row] = await this.deps.db
      .select({ m: modelCatalog })
      .from(modelCatalog)
      .innerJoin(providerConnections, eq(providerConnections.id, modelCatalog.connectionId))
      .where(and(eq(modelCatalog.id, modelCatalogId), eq(providerConnections.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new AppError('NOT_CONFIGURED', 'El modelo configurado no existe en el catálogo de esta organización');
    if (!row.m.enabled) throw new AppError('NOT_CONFIGURED', `El modelo ${row.m.modelId} está deshabilitado`);
    return {
      modelCatalogId: row.m.id,
      provider: row.m.provider,
      connectionId: row.m.connectionId,
      modelId: row.m.modelId,
      functions: row.m.functions,
      contextWindow: row.m.contextWindow,
      maxOutputTokens: row.m.maxOutputTokens,
      embeddingDimensions: row.m.embeddingDimensions,
    };
  }

  async languageModel(m: ResolvedModel): Promise<LanguageModelV4> {
    const { client } = await this.connections.client(await this.orgOf(m.connectionId), m.connectionId);
    return client.languageModel(m.modelId);
  }

  async embeddingModel(organizationId: string, m: ResolvedModel): Promise<EmbeddingModelV4> {
    const { client } = await this.connections.client(organizationId, m.connectionId);
    const model = client.embeddingModel(m.modelId);
    if (!model) throw new AppError('CAPABILITY_UNSUPPORTED', `El proveedor de ${m.modelId} no soporta embeddings`);
    return model;
  }

  async transcriptionModel(organizationId: string, m: ResolvedModel): Promise<TranscriptionModelV4> {
    const { client } = await this.connections.client(organizationId, m.connectionId);
    const model = client.transcriptionModel(m.modelId);
    if (!model) throw new AppError('CAPABILITY_UNSUPPORTED', `El proveedor de ${m.modelId} no soporta transcripción`);
    return model;
  }

  private async orgOf(connectionId: string): Promise<string> {
    const [c] = await this.deps.db.select({ org: providerConnections.organizationId }).from(providerConnections).where(eq(providerConnections.id, connectionId));
    return c!.org;
  }

  /** Upper-bound estimate (input + maximum output). null when a needed tariff is unknown. */
  async estimate(m: ResolvedModel, units: Record<string, number>): Promise<string | null> {
    const prices = await this.prices.current(m.provider, m.modelId, m.connectionId);
    let total = ZERO;
    for (const [unit, qty] of Object.entries(units)) {
      const p = prices.find((x) => x.unit === unit);
      if (!p) return null;
      total = add(total, costOf(qty, p.price, p.unitQuantity));
    }
    return total;
  }

  /**
   * Reserves budget for an estimated call. With a hard budget and an unknown tariff the call is
   * refused: spending cannot be bounded without a price.
   */
  async reserve(scope: BudgetScope, estimate: string | null, aiRequestId: string): Promise<string | null> {
    if (estimate === null) {
      if (await this.budgets.hasHardLimit(scope)) {
        throw new AppError('BUDGET_EXCEEDED', 'El modelo no tiene tarifa conocida y hay un presupuesto con límite estricto; registra la tarifa antes de usarlo');
      }
      return null;
    }
    return this.budgets.reserve(scope, estimate, aiRequestId);
  }

  get budgetsService(): BudgetsService {
    return this.budgets;
  }

  /** Non-streaming text/structured generation with retries, fallbacks, ledger and budget. */
  async generate<T = never>(
    ctx: CallContext,
    modelCatalogId: string,
    input: {
      system?: string;
      prompt?: string;
      messages?: ModelMessage[];
      maxOutputTokens: number;
      temperature?: number;
      schema?: z.ZodType<T>;
      abortSignal?: AbortSignal;
    },
    policy: Partial<RetryPolicy> = {},
  ): Promise<{ text: string; object: T | null; costUsd: string | null; costStatus: string; aiRequestId: string; modelId: string; latencyMs: number }> {
    const p = { ...DEFAULT_RETRY, ...policy };
    const primary = await this.resolve(ctx.organizationId, modelCatalogId);
    const chars = (input.system?.length ?? 0) + (input.prompt?.length ?? 0) + JSON.stringify(input.messages ?? []).length;
    const estimate = await this.estimate(primary, { input_tokens: estimateTokens(chars), output_tokens: input.maxOutputTokens });
    const aiRequestId = await this.ledger.start({ ...ctx, provider: primary.provider, connectionId: primary.connectionId, modelId: primary.modelId, estimatedCostUsd: estimate });
    const reservation = await this.reserve({ organizationId: ctx.organizationId, userId: ctx.userId, agentId: ctx.agentId, feature: ctx.feature }, estimate, aiRequestId).catch(async (err) => {
      await this.ledger.finish(aiRequestId, { status: 'failed', errorKind: 'budget', error: (err as Error).message });
      throw err;
    });
    const chain = [primary, ...(await Promise.all(p.fallbackModelCatalogIds.map((id) => this.resolve(ctx.organizationId, id).catch(() => null))))].filter(Boolean) as ResolvedModel[];
    const t0 = Date.now();
    let lastErr: unknown;
    for (const model of chain) {
      for (let attempt = 0; attempt <= p.retries; attempt++) {
        const attemptId = await this.ledger.startAttempt(aiRequestId, { provider: model.provider, connectionId: model.connectionId, modelId: model.modelId });
        try {
          const lm = await this.languageModel(model);
          const signal = input.abortSignal ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(p.timeoutMs)]) : AbortSignal.timeout(p.timeoutMs);
          const common = {
            model: lm,
            system: input.system,
            maxOutputTokens: input.maxOutputTokens,
            temperature: input.temperature,
            maxRetries: 0,
            abortSignal: signal,
          };
          const result = input.schema
            ? await generateText({ ...common, ...(input.messages ? { messages: input.messages } : { prompt: input.prompt ?? '' }), output: Output.object({ schema: input.schema }) })
            : await generateText({ ...common, ...(input.messages ? { messages: input.messages } : { prompt: input.prompt ?? '' }) });
          const u = unitsFromUsage(result.totalUsage as never);
          await this.ledger.finishAttempt(attemptId, { status: 'succeeded', units: u.units, usageStatus: u.known ? 'known' : 'unknown' });
          const cost = await this.ledger.finish(aiRequestId, { status: 'succeeded', metadata: { servedBy: model.modelId } });
          await this.budgets.settle(reservation, cost.costUsd);
          return {
            text: result.text,
            object: input.schema ? ((result as unknown as { output: T }).output ?? null) : null,
            costUsd: cost.costUsd,
            costStatus: cost.costStatus,
            aiRequestId,
            modelId: model.modelId,
            latencyMs: Date.now() - t0,
          };
        } catch (err) {
          lastErr = err;
          const c = classifyAiError(err);
          // Errors raised before the provider processed the request are not billable.
          const billable = c.kind === 'timeout';
          await this.ledger.finishAttempt(attemptId, { status: 'failed', usageStatus: 'unknown', billable, errorKind: c.kind, error: c.message });
          if (!c.retryable) break;
          await sleep(Math.min(4000, 400 * 2 ** attempt));
        }
      }
    }
    const c = classifyAiError(lastErr);
    const cost = await this.ledger.finish(aiRequestId, { status: 'failed', errorKind: c.kind, error: c.message });
    if (cost.costStatus === 'unknown') await this.budgets.settle(reservation, null);
    else await this.budgets.release(reservation);
    throw new AppError('UPSTREAM_ERROR', `El proveedor IA falló (${c.kind}): ${c.message}`, { errorKind: c.kind, aiRequestId }, { retryable: c.retryable });
  }

  /** Embeddings for RAG indexing and queries (batched, recorded and budgeted). */
  async embed(ctx: CallContext, modelCatalogId: string, values: string[], opts: { abortSignal?: AbortSignal } = {}) {
    const model = await this.resolve(ctx.organizationId, modelCatalogId);
    if (!model.functions.includes('embedding')) throw new AppError('CAPABILITY_UNSUPPORTED', `${model.modelId} no es un modelo de embeddings`);
    const tokens = values.reduce((s, v) => s + estimateTokens(v.length), 0);
    const estimate = await this.estimate(model, { embedding_tokens: tokens });
    const aiRequestId = await this.ledger.start({ ...ctx, provider: model.provider, connectionId: model.connectionId, modelId: model.modelId, estimatedCostUsd: estimate });
    const reservation = await this.reserve({ organizationId: ctx.organizationId, userId: ctx.userId, agentId: ctx.agentId, feature: ctx.feature }, estimate, aiRequestId).catch(async (err) => {
      await this.ledger.finish(aiRequestId, { status: 'failed', errorKind: 'budget', error: (err as Error).message });
      throw err;
    });
    const attemptId = await this.ledger.startAttempt(aiRequestId, { provider: model.provider, connectionId: model.connectionId, modelId: model.modelId });
    try {
      const em = await this.embeddingModel(ctx.organizationId, model);
      const r = await embedMany({ model: em, values, maxRetries: 2, abortSignal: opts.abortSignal });
      const reported = r.usage?.tokens;
      await this.ledger.finishAttempt(attemptId, {
        status: 'succeeded',
        units: { embedding_tokens: reported ?? tokens },
        usageStatus: reported !== undefined ? 'known' : 'estimated',
      });
      const cost = await this.ledger.finish(aiRequestId, { status: 'succeeded' });
      await this.budgets.settle(reservation, cost.costUsd);
      return { embeddings: r.embeddings, costUsd: cost.costUsd, costStatus: cost.costStatus, aiRequestId, tokens: reported ?? tokens };
    } catch (err) {
      const c = classifyAiError(err);
      await this.ledger.finishAttempt(attemptId, { status: opts.abortSignal?.aborted ? 'cancelled' : 'failed', usageStatus: 'unknown', billable: false, errorKind: c.kind, error: c.message });
      await this.ledger.finish(aiRequestId, { status: 'failed', errorKind: c.kind, error: c.message });
      await this.budgets.release(reservation);
      throw new AppError('UPSTREAM_ERROR', `Embeddings fallaron (${c.kind}): ${c.message}`, { errorKind: c.kind }, { retryable: c.retryable });
    }
  }

  /** Transcription of a completed recording (no streaming assumption). */
  async transcribe(ctx: CallContext, modelCatalogId: string, audio: Uint8Array, opts: { language?: string; abortSignal?: AbortSignal; maxSeconds: number }) {
    const model = await this.resolve(ctx.organizationId, modelCatalogId);
    if (!model.functions.includes('transcription')) throw new AppError('CAPABILITY_UNSUPPORTED', `${model.modelId} no es un modelo de transcripción`);
    const estimate = await this.estimate(model, { audio_seconds: opts.maxSeconds });
    const aiRequestId = await this.ledger.start({ ...ctx, provider: model.provider, connectionId: model.connectionId, modelId: model.modelId, estimatedCostUsd: estimate });
    const reservation = await this.reserve({ organizationId: ctx.organizationId, userId: ctx.userId, agentId: ctx.agentId, feature: 'transcription' }, estimate, aiRequestId).catch(async (err) => {
      await this.ledger.finish(aiRequestId, { status: 'failed', errorKind: 'budget', error: (err as Error).message });
      throw err;
    });
    const attemptId = await this.ledger.startAttempt(aiRequestId, { provider: model.provider, connectionId: model.connectionId, modelId: model.modelId });
    try {
      const tm = await this.transcriptionModel(ctx.organizationId, model);
      const r = await transcribe({
        model: tm,
        audio,
        abortSignal: opts.abortSignal,
        providerOptions: opts.language ? { openai: { language: opts.language } } : undefined,
      });
      const seconds = r.durationInSeconds;
      await this.ledger.finishAttempt(attemptId, {
        status: 'succeeded',
        units: { audio_seconds: Math.ceil(seconds ?? opts.maxSeconds) },
        usageStatus: seconds !== undefined ? 'known' : 'estimated',
      });
      const cost = await this.ledger.finish(aiRequestId, { status: 'succeeded' });
      await this.budgets.settle(reservation, cost.costUsd);
      return { text: r.text, language: r.language ?? null, durationInSeconds: seconds ?? null, costUsd: cost.costUsd, costStatus: cost.costStatus, aiRequestId };
    } catch (err) {
      const c = classifyAiError(err);
      const cancelled = opts.abortSignal?.aborted;
      await this.ledger.finishAttempt(attemptId, { status: cancelled ? 'cancelled' : 'failed', usageStatus: 'unknown', billable: false, errorKind: c.kind, error: c.message });
      await this.ledger.finish(aiRequestId, { status: cancelled ? 'cancelled' : 'failed', errorKind: c.kind, error: c.message });
      await this.budgets.release(reservation);
      throw new AppError('UPSTREAM_ERROR', `La transcripción falló (${c.kind}): ${c.message}`, { errorKind: c.kind }, { retryable: c.retryable });
    }
  }
}
