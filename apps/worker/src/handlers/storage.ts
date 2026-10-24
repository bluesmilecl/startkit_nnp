import { QUEUES } from '@starter/jobs';
import { createLogger } from '@starter/observability';
import type { WorkerContext } from '../context.js';

const log = createLogger('worker-storage');

export interface StoragePurgeJob {
  keys: string[];
  reason: string;
}

/** Traceable purge of original files (deleted users, removed documents, expired audio). */
export async function registerStorageHandlers(ctx: WorkerContext): Promise<void> {
  await ctx.jobs.work<StoragePurgeJob>(QUEUES.storagePurge, async (data) => {
    let deleted = 0;
    for (const key of data.keys) {
      await ctx.storage.delete(key);
      deleted++;
    }
    log.info({ deleted, reason: data.reason }, 'files purged');
  });
}
