import { createMessagingServices, type MessagingServices } from '@starter/messaging';
import { lt, mailDeliveries, sql } from '@starter/db';
import { QUEUES } from '@starter/jobs';
import { createLogger } from '@starter/observability';
import type { WorkerContext } from '../context.js';
import { onMaintenance } from './system.js';

const log = createLogger('worker-mail');
const DELIVERY_RETENTION_DAYS = 90;

export function messagingServicesFor(ctx: WorkerContext): MessagingServices {
  return createMessagingServices({ db: ctx.db.db, env: ctx.env, secrets: ctx.secrets, mailer: ctx.mailer, jobs: ctx.jobs });
}

/** Mail automations: a tick every minute turns audit events and schedules into durable sends. */
export async function registerMailHandlers(ctx: WorkerContext, mail: MessagingServices): Promise<void> {
  await ctx.jobs.work(QUEUES.mailAutomationsTick, async () => {
    const r = await mail.automations.tick();
    for (const q of r.queued) await ctx.jobs.send(QUEUES.mailSend, { deliveryId: q.id }, { startAfter: q.startAfter, idempotencyKey: q.id });
  });

  await ctx.jobs.work<{ deliveryId: string }>(QUEUES.mailSend, async (data) => {
    await mail.automations.deliver(data.deliveryId);
  }, { concurrency: 4 });

  onMaintenance(async () => {
    const rows = await ctx.db.db
      .delete(mailDeliveries)
      .where(lt(mailDeliveries.createdAt, sql`now() - make_interval(days => ${DELIVERY_RETENTION_DAYS})`))
      .returning({ id: mailDeliveries.id });
    if (rows.length) log.info({ purged: rows.length }, 'old mail deliveries purged');
  });
}
