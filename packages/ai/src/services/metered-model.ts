import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { classifyAiError } from '../errors.js';
import { unitsFromUsage, type UsageLedger } from './ledger.js';
import type { ResolvedModel } from './runtime.js';

export interface MeteredLink {
  model: ResolvedModel;
  lm: LanguageModelV4;
}

export interface MeteredOptions {
  retries: number;
  /** Called with the model that actually served each successful call (fallbacks included). */
  onServed?: (model: ResolvedModel) => void;
}

const estimateTokens = (chars: number) => Math.max(1, Math.ceil(chars / 4));
const promptChars = (o: LanguageModelV4CallOptions) => JSON.stringify(o.prompt).length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * LanguageModel wrapper used by the chat: retries and falls back across a chain of catalog
 * models, and records every real provider invocation (each tool-loop step, retry and fallback)
 * as one ledger attempt with its own usage. A stream that fails before producing content is
 * retried/fallen back transparently; once content was emitted, errors surface to the caller.
 * Interrupted streams are recorded with estimated usage instead of being lost.
 */
export class MeteredLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: LanguageModelV4['supportedUrls'];
  /** Attempts started and not yet written to the ledger. */
  private readonly pending = new Map<string, () => Promise<void>>();

  constructor(
    private readonly chain: MeteredLink[],
    private readonly ledger: UsageLedger,
    private readonly aiRequestId: string,
    private readonly opts: MeteredOptions,
  ) {
    const first = chain[0]!;
    this.provider = first.lm.provider;
    this.modelId = first.lm.modelId;
    // URLs are never passed through: attachments are inlined as data by the server.
    this.supportedUrls = {};
  }

  private start(link: MeteredLink) {
    return this.ledger.startAttempt(this.aiRequestId, { provider: link.model.provider, connectionId: link.model.connectionId, modelId: link.model.modelId });
  }

  /**
   * Waits until every started attempt is recorded. Streams abandoned by the consumer are closed
   * after `timeoutMs` as cancelled with estimated usage, so the request total is never computed
   * from half-written attempts.
   */
  async idle(timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let running = await this.ledger.runningAttempts(this.aiRequestId);
    while (running.length && Date.now() < deadline) {
      await sleep(50);
      running = await this.ledger.runningAttempts(this.aiRequestId);
    }
    await Promise.all([...this.pending.values()].map((force) => force()));
    // Calls interrupted before producing content: nothing billable is known.
    for (const id of await this.ledger.runningAttempts(this.aiRequestId)) {
      await this.ledger.finishAttempt(id, { status: 'cancelled', usageStatus: 'unknown', billable: false, error: 'Interrumpido antes de recibir contenido' });
    }
  }

  async doGenerate(options: LanguageModelV4CallOptions) {
    let lastErr: unknown;
    for (const link of this.chain) {
      for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
        const attemptId = await this.start(link);
        try {
          const r = await link.lm.doGenerate(options);
          const u = unitsFromUsage(r.usage as never);
          await this.ledger.finishAttempt(attemptId, { status: 'succeeded', units: u.units, usageStatus: u.known ? 'known' : 'unknown' });
          this.opts.onServed?.(link.model);
          return r;
        } catch (err) {
          lastErr = err;
          const c = classifyAiError(err);
          const aborted = options.abortSignal?.aborted;
          await this.ledger.finishAttempt(attemptId, { status: aborted ? 'cancelled' : 'failed', usageStatus: 'unknown', billable: c.kind === 'timeout', errorKind: c.kind, error: c.message });
          if (aborted) throw err;
          if (!c.retryable) break;
          await sleep(Math.min(4000, 400 * 2 ** attempt));
        }
      }
    }
    throw lastErr;
  }

  async doStream(options: LanguageModelV4CallOptions) {
    let lastErr: unknown;
    for (const link of this.chain) {
      for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
        const attemptId = await this.start(link);
        let reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | undefined;
        try {
          const result = await link.lm.doStream(options);
          reader = result.stream.getReader();
          // Buffer until the first content part: errors before it are retried / fallen back.
          const buffered: LanguageModelV4StreamPart[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === 'error') throw value.error;
            buffered.push(value);
            if (!['stream-start', 'response-metadata', 'raw'].includes(value.type)) break;
          }
          this.opts.onServed?.(link.model);
          return { ...result, stream: this.meter(reader, buffered, attemptId, options) };
        } catch (err) {
          lastErr = err;
          await reader?.cancel().catch(() => {});
          const c = classifyAiError(err);
          const aborted = options.abortSignal?.aborted;
          await this.ledger.finishAttempt(attemptId, { status: aborted ? 'cancelled' : 'failed', usageStatus: 'unknown', billable: c.kind === 'timeout', errorKind: c.kind, error: c.message });
          if (aborted) throw err;
          if (!c.retryable) break;
          await sleep(Math.min(4000, 400 * 2 ** attempt));
        }
      }
    }
    throw lastErr;
  }

  private meter(
    reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart>,
    buffered: LanguageModelV4StreamPart[],
    attemptId: string,
    options: LanguageModelV4CallOptions,
  ): ReadableStream<LanguageModelV4StreamPart> {
    const ledger = this.ledger;
    let outChars = 0;
    let settled = false;
    const count = (p: LanguageModelV4StreamPart) => {
      if (p.type === 'text-delta' || p.type === 'reasoning-delta') outChars += p.delta.length;
      else if (p.type === 'tool-call') outChars += p.input.length;
    };
    const settle = async (o: Parameters<UsageLedger['finishAttempt']>[1]) => {
      if (settled) return;
      settled = true;
      await ledger.finishAttempt(attemptId, o).catch(() => {});
      this.pending.delete(attemptId);
    };
    // Interrupted: the provider already processed the prompt and produced output → estimated.
    const interrupted = (status: 'cancelled' | 'failed', err?: unknown) => {
      const c = err ? classifyAiError(err) : null;
      return settle({
        status,
        units: { input_tokens: estimateTokens(promptChars(options)), output_tokens: estimateTokens(outChars) },
        usageStatus: 'estimated',
        errorKind: c?.kind ?? null,
        error: c?.message ?? (status === 'cancelled' ? 'Cancelado por la persona usuaria' : null),
      });
    };
    buffered.forEach(count);
    this.pending.set(attemptId, () => interrupted('cancelled'));
    return new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        for (const p of buffered) controller.enqueue(p);
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (!settled) await interrupted(options.abortSignal?.aborted ? 'cancelled' : 'failed', new Error('El proveedor cerró la respuesta sin finalizar'));
            controller.close();
            return;
          }
          count(value);
          if (value.type === 'finish') {
            const u = unitsFromUsage(value.usage as never);
            await settle({ status: 'succeeded', units: u.units, usageStatus: u.known ? 'known' : 'unknown' });
          } else if (value.type === 'error') {
            await interrupted('failed', value.error);
          }
          controller.enqueue(value);
        } catch (err) {
          await interrupted(options.abortSignal?.aborted ? 'cancelled' : 'failed', err);
          controller.error(err);
        }
      },
      async cancel(reason) {
        await interrupted('cancelled');
        await reader.cancel(reason).catch(() => {});
      },
    });
  }
}
