import type { AiServices } from '@starter/ai';
import { QUEUES, type QueueName } from '@starter/jobs';
import { createLogger } from '@starter/observability';
import { createRagServices, type RagServices } from '@starter/rag';
import type { WorkerContext } from '../context.js';
import { onMaintenance } from './system.js';

const log = createLogger('worker-rag');

export function ragServicesFor(ctx: WorkerContext, ai: AiServices): RagServices {
  return createRagServices({ db: ctx.db.db, env: ctx.env, features: ctx.features, mailer: ctx.mailer, secrets: ctx.secrets, storage: ctx.storage, jobs: ctx.jobs, ai });
}

/** Ingestion pipeline: every RAG queue carries the id of a rag_jobs row with progress and cost. */
export async function registerRagHandlers(ctx: WorkerContext, rag: RagServices): Promise<void> {
  const queues: [QueueName, number][] = [
    [QUEUES.ragIngestSource, 1],
    [QUEUES.ragIngestDocument, 3],
    [QUEUES.ragReindex, 1],
    [QUEUES.ragDeleteDocument, 2],
    [QUEUES.ragPurge, 1],
  ];
  for (const [queue, concurrency] of queues) {
    await ctx.jobs.work<{ ragJobId: string }>(queue, async (data, { retryCount }) => rag.ingestion.run(data.ragJobId, retryCount), { concurrency });
  }
  await ctx.jobs.work(QUEUES.ragScheduleTick, async () => {
    const r = await rag.ingestion.tick();
    if (r.syncs || r.expired) log.info(r, 'rag schedule tick');
  });
  onMaintenance(async () => {
    const stale = await rag.jobs.staleRunning(15);
    if (stale.length) log.warn({ jobs: stale.map((j) => j.id) }, 'rag jobs without heartbeat');
  });
}
