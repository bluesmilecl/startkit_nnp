import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { pino, type Logger, type LoggerOptions } from 'pino';

/** Paths never written to logs. Prompts and document content are excluded by default as well. */
export const REDACT_PATHS = [
  'password',
  'secret',
  'token',
  'apiKey',
  'credential',
  'authorization',
  'cookie',
  'otp',
  'code',
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.credential',
  '*.otp',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'prompt',
  'messages',
  'content',
  '*.prompt',
  '*.messages',
];

export interface RequestContext {
  requestId: string;
  userId?: string;
  organizationId?: string;
  jobId?: string;
  aiRequestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  const parent = storage.getStore();
  return storage.run({ ...parent, ...ctx, requestId: ctx.requestId ?? parent?.requestId ?? randomUUID() }, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function setContextValue<K extends keyof RequestContext>(key: K, value: RequestContext[K]): void {
  const store = storage.getStore();
  if (store) store[key] = value;
}

export function newRequestId(): string {
  return randomUUID();
}

export function createLogger(name: string, options: LoggerOptions = {}): Logger {
  const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
  return pino({
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const ctx = storage.getStore();
      return ctx ? { requestId: ctx.requestId, userId: ctx.userId, orgId: ctx.organizationId, jobId: ctx.jobId } : {};
    },
    ...options,
  });
}

/** Removes stack traces and obvious secrets from error messages before persisting them. */
export function sanitizeError(err: unknown, maxLength = 500): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
  return (message ?? 'Unknown error')
    .replace(/(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '$1-[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+@/gi, '$1[redacted]@')
    .replace(/(api[_-]?key=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, maxLength);
}

export interface Counter {
  inc(labels?: Record<string, string>, value?: number): void;
}

/** Minimal in-process metrics registry exposed by /api/health/metrics in Prometheus text format. */
class MetricsRegistry {
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly gauges = new Map<string, () => number>();

  counter(name: string): Counter {
    if (!this.counters.has(name)) this.counters.set(name, new Map());
    const series = this.counters.get(name)!;
    return {
      inc(labels = {}, value = 1) {
        const key = Object.entries(labels)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
          .join(',');
        series.set(key, (series.get(key) ?? 0) + value);
      },
    };
  }

  gauge(name: string, read: () => number): void {
    this.gauges.set(name, read);
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, series] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const [labels, value] of series) lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
    }
    for (const [name, read] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`, `${name} ${read()}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

export const metrics = new MetricsRegistry();
export type { Logger };
