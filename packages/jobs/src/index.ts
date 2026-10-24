import { createLogger, sanitizeError } from '@starter/observability';
import { PgBoss } from 'pg-boss';

const log = createLogger('jobs');

/**
 * Queue catalog. Long operations never depend on an open HTTP request: the API enqueues and
 * returns a job id; the worker processes with leases, retries with backoff and idempotency keys.
 */
export const QUEUES = {
  maintenance: 'system.maintenance',
  versionCheck: 'system.version-check',
  workerHeartbeat: 'system.worker-heartbeat',
  storagePurge: 'storage.purge',
  aiSyncModels: 'ai.sync-models',
  aiSyncPrices: 'ai.sync-prices',
  aiLabRun: 'ai.lab-run',
  aiFxRates: 'ai.fx-rates',
  aiBudgetAlerts: 'ai.budget-alerts',
  ragIngestSource: 'rag.ingest-source',
  ragIngestDocument: 'rag.ingest-document',
  ragReindex: 'rag.reindex',
  ragDeleteDocument: 'rag.delete-document',
  ragPurge: 'rag.purge',
  ragScheduleTick: 'rag.schedule-tick',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

interface QueueDefinition {
  name: QueueName;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  expireInSeconds: number;
  deleteAfterSeconds?: number;
  policy?: 'standard' | 'singleton' | 'stately';
}

const DEFINITIONS: QueueDefinition[] = [
  { name: QUEUES.maintenance, retryLimit: 1, retryDelay: 60, retryBackoff: false, expireInSeconds: 600, policy: 'singleton' },
  { name: QUEUES.versionCheck, retryLimit: 2, retryDelay: 300, retryBackoff: true, expireInSeconds: 300, policy: 'singleton' },
  { name: QUEUES.workerHeartbeat, retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 60, deleteAfterSeconds: 3600 },
  { name: QUEUES.storagePurge, retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 600 },
  { name: QUEUES.aiSyncModels, retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 600, policy: 'stately' },
  { name: QUEUES.aiSyncPrices, retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 600, policy: 'stately' },
  { name: QUEUES.aiLabRun, retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 1800 },
  { name: QUEUES.aiFxRates, retryLimit: 3, retryDelay: 300, retryBackoff: true, expireInSeconds: 120, policy: 'singleton' },
  { name: QUEUES.aiBudgetAlerts, retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 300 },
  { name: QUEUES.ragIngestSource, retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 3600 },
  { name: QUEUES.ragIngestDocument, retryLimit: 5, retryDelay: 15, retryBackoff: true, expireInSeconds: 1800 },
  { name: QUEUES.ragReindex, retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 7200 },
  { name: QUEUES.ragDeleteDocument, retryLimit: 8, retryDelay: 15, retryBackoff: true, expireInSeconds: 600 },
  { name: QUEUES.ragPurge, retryLimit: 8, retryDelay: 60, retryBackoff: true, expireInSeconds: 3600 },
  { name: QUEUES.ragScheduleTick, retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 120, policy: 'singleton' },
];

/** Periodic schedules (cron, UTC). pg-boss guarantees a single firing across replicas. */
export const SCHEDULES: { name: QueueName; cron: string }[] = [
  { name: QUEUES.maintenance, cron: '*/5 * * * *' },
  { name: QUEUES.versionCheck, cron: '17 6 * * *' },
  { name: QUEUES.workerHeartbeat, cron: '* * * * *' },
  { name: QUEUES.aiSyncPrices, cron: '23 5 * * *' },
  { name: QUEUES.aiFxRates, cron: '41 13 * * 1-5' },
  { name: QUEUES.aiBudgetAlerts, cron: '*/10 * * * *' },
  { name: QUEUES.ragScheduleTick, cron: '* * * * *' },
];

export interface JobsOptions {
  connectionString: string;
  ssl?: unknown;
  /** API instances only enqueue; workers supervise and run schedules. */
  role: 'api' | 'worker' | 'migrate';
  schema?: string;
}

export type JobHandler<T> = (data: T, ctx: { jobId: string; retryCount: number; signal: AbortSignal }) => Promise<unknown>;

export class JobQueue {
  private constructor(readonly boss: PgBoss) {}

  static async create(opts: JobsOptions): Promise<JobQueue> {
    const boss = new PgBoss({
      connectionString: opts.connectionString,
      ssl: opts.ssl,
      schema: opts.schema ?? 'pgboss',
      application_name: `starter-${opts.role}`,
      // Only the migrate service runs DDL; api/worker can use a least-privilege role.
      migrate: opts.role === 'migrate',
      createSchema: opts.role === 'migrate',
      supervise: opts.role === 'worker',
      schedule: opts.role === 'worker',
      max: opts.role === 'worker' ? 10 : 4,
    } as ConstructorParameters<typeof PgBoss>[0]);
    boss.on('error', (err: unknown) => log.error({ err: sanitizeError(err) }, 'pg-boss error'));
    await boss.start();
    const queue = new JobQueue(boss);
    if (opts.role === 'migrate') await queue.ensureQueues();
    return queue;
  }

  async ensureQueues(): Promise<void> {
    for (const d of DEFINITIONS) {
      const { name, policy, ...options } = d;
      const existing = await this.boss.getQueue(name);
      if (!existing) await this.boss.createQueue(name, { ...options, policy: policy ?? 'standard' });
      else await this.boss.updateQueue(name, options);
    }
  }

  async ensureSchedules(): Promise<void> {
    for (const s of SCHEDULES) await this.boss.schedule(s.name, s.cron, {}, { tz: 'UTC' } as never);
  }

  /**
   * Enqueue with an idempotency key: the same key while a job is pending returns null
   * (pg-boss singleton semantics) so duplicated requests never create duplicated work.
   */
  async send<T extends object>(name: QueueName, data: T, opts: { idempotencyKey?: string; startAfter?: Date | number; priority?: number } = {}): Promise<string | null> {
    // pg-boss validates present keys, so undefined options are omitted rather than sent.
    const options: Record<string, unknown> = {};
    if (opts.idempotencyKey) options.singletonKey = opts.idempotencyKey;
    if (opts.startAfter !== undefined) options.startAfter = opts.startAfter;
    if (opts.priority !== undefined) options.priority = opts.priority;
    return this.boss.send(name, data, options);
  }

  async work<T>(name: QueueName, handler: JobHandler<T>, opts: { concurrency?: number; pollingIntervalSeconds?: number } = {}): Promise<string> {
    return this.boss.work<T>(name, { localConcurrency: opts.concurrency ?? 1, pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 }, async (jobs) => {
      for (const job of jobs) {
        const started = Date.now();
        try {
          await handler(job.data, { jobId: job.id, retryCount: job.retryCount, signal: job.signal });
          log.debug({ queue: name, jobId: job.id, ms: Date.now() - started }, 'job done');
        } catch (err) {
          log.warn({ queue: name, jobId: job.id, retry: job.retryCount, err: sanitizeError(err) }, 'job failed');
          throw err;
        }
      }
    });
  }

  async cancel(name: QueueName, id: string): Promise<void> {
    await this.boss.cancel(name, id);
  }

  async stats(): Promise<{ queued: number; active: number; failed: number }> {
    let queued = 0;
    let active = 0;
    let failed = 0;
    for (const d of DEFINITIONS) {
      const q = (await this.boss.getQueue(d.name)) as { queuedCount?: number; activeCount?: number; failedCount?: number } | null;
      queued += q?.queuedCount ?? 0;
      active += q?.activeCount ?? 0;
      failed += q?.failedCount ?? 0;
    }
    return { queued, active, failed };
  }

  async stop(graceful = true): Promise<void> {
    await this.boss.stop({ graceful, timeout: 30_000 } as never);
  }
}
