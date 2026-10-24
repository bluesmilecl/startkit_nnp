import { createAdminExecutors, loadActor, ProposalsService } from '@starter/auth';
import { createAiServices, fetchClpRate, type AiServices } from '@starter/ai';
import { AppError } from '@starter/contracts';
import { and, attachments, eq, fxRates, lt, sql } from '@starter/db';
import { QUEUES } from '@starter/jobs';
import { createLogger } from '@starter/observability';
import type { WorkerContext } from '../context.js';
import { onMaintenance } from './system.js';

const log = createLogger('worker-ai');

/** Builds the same AI service graph the API uses (no duplicated domain logic in the worker). */
export function aiServicesFor(ctx: WorkerContext): AiServices {
  return createAiServices({ db: ctx.db.db, env: ctx.env, features: ctx.features, mailer: ctx.mailer, secrets: ctx.secrets });
}

export async function registerAiHandlers(ctx: WorkerContext, ai: AiServices): Promise<void> {
  await ctx.jobs.work<{ connectionId: string; organizationId: string; userId?: string | null }>(QUEUES.aiSyncModels, async (data) => {
    // The actor is reloaded when the job runs: a revoked permission stops the queued sync.
    const actor = data.userId ? await loadActor({ db: ctx.db.db, features: ctx.features }, { userId: data.userId, organizationId: data.organizationId, channel: 'system' }) : null;
    const stats = await ai.models.sync(actor, data.connectionId, data.organizationId);
    log.info({ connectionId: data.connectionId, ...stats }, 'models synced');
  });

  await ctx.jobs.work<{ userId?: string | null }>(QUEUES.aiSyncPrices, async (data) => {
    const stats = await ai.prices.syncFromCatalog(data.userId ?? null);
    log.info(stats, 'prices synced');
  });

  await ctx.jobs.work<{ runId: string }>(QUEUES.aiLabRun, async (data, { signal }) => ai.lab.execute(data.runId, signal), { concurrency: 2 });

  await ctx.jobs.work<{ force?: boolean }>(QUEUES.aiFxRates, async (data) => {
    if (ctx.env.FX_PROVIDER === 'none' && !data.force) return;
    if (ctx.env.FX_PROVIDER === 'none') {
      log.info('FX_PROVIDER=none: CLP conversion stays disabled');
      return;
    }
    const rate = await fetchClpRate();
    if (!rate) throw AppError.upstream('mindicador.cl no devolvió un valor de dólar observado');
    await ctx.db.db
      .insert(fxRates)
      .values({ base: 'USD', quote: 'CLP', rate: rate.rate, rateDate: rate.rateDate, source: rate.source, sourceUrl: rate.sourceUrl })
      .onConflictDoUpdate({ target: [fxRates.base, fxRates.quote, fxRates.rateDate, fxRates.source], set: { rate: rate.rate, fetchedAt: new Date() } });
    log.info({ rate: rate.rate, rateDate: rate.rateDate }, 'CLP rate stored');
  });

  await ctx.jobs.work(QUEUES.aiBudgetAlerts, async () => {
    const sent = await ai.budgets.evaluateAlerts();
    if (sent) log.info({ sent }, 'budget alerts sent');
  });

  const access = { db: ctx.db.db, env: ctx.env, features: ctx.features, mailer: ctx.mailer };
  const proposals = new ProposalsService(access, createAdminExecutors(access));
  onMaintenance(async () => {
    // Reservations whose call never settled (crash, lost connection) are charged at their estimate.
    const settled = await ai.budgets.expireStale();
    if (settled) log.info({ settled }, 'stale budget reservations settled at their estimate');
    const expired = await proposals.expireStale();
    if (expired) log.info({ expired }, 'pending chat action proposals expired');
    // Uploads never attached to a message (abandoned composer) are removed after 24 h.
    const orphans = await ctx.db.db
      .delete(attachments)
      .where(and(eq(attachments.status, 'uploaded'), lt(attachments.createdAt, sql`now() - interval '24 hours'`)))
      .returning({ key: attachments.storageKey });
    for (const o of orphans) await ctx.storage.delete(o.key).catch(() => {});
    if (orphans.length) log.info({ removed: orphans.length }, 'orphan chat uploads removed');
  });
}
