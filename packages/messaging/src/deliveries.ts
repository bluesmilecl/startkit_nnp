import { assertCan, recordAudit, type Actor } from '@starter/auth';
import { AppError, type MailDeliveriesQuery, type MailDelivery } from '@starter/contracts';
import { and, count, desc, eq, ilike, likeTerm, mailAutomations, mailDeliveries, normalizePage, offsetOf, toPage } from '@starter/db';
import { QUEUES } from '@starter/jobs';
import type { MessagingDeps } from './context.js';

/** Log of every e-mail sent by the platform (subjects are never stored: they can carry codes). */
export class MailDeliveriesService {
  constructor(private readonly deps: MessagingDeps) {}

  async list(actor: Actor, q: MailDeliveriesQuery) {
    assertCan(actor, 'mail.read');
    const params = normalizePage(q);
    const where = and(
      q.status ? eq(mailDeliveries.status, q.status) : undefined,
      q.automationId ? eq(mailDeliveries.automationId, q.automationId) : undefined,
      q.search ? ilike(mailDeliveries.toAddress, likeTerm(q.search)) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.deps.db
        .select({ d: mailDeliveries, a: { id: mailAutomations.id, name: mailAutomations.name } })
        .from(mailDeliveries)
        .leftJoin(mailAutomations, eq(mailAutomations.id, mailDeliveries.automationId))
        .where(where)
        .orderBy(desc(mailDeliveries.createdAt), desc(mailDeliveries.id))
        .limit(params.pageSize)
        .offset(offsetOf(params)),
      this.deps.db.select({ n: count() }).from(mailDeliveries).where(where),
    ]);
    const items = rows.map(({ d, a }): MailDelivery => ({
      id: d.id,
      status: d.status,
      to: d.toAddress,
      templateKey: d.templateKey,
      category: d.category,
      automation: a?.id ? { id: a.id, name: a.name } : null,
      transport: d.transport,
      messageId: d.messageId,
      error: d.error,
      attempts: d.attempts,
      createdAt: d.createdAt.toISOString(),
      scheduledFor: d.scheduledFor?.toISOString() ?? null,
      sentAt: d.sentAt?.toISOString() ?? null,
    }));
    return toPage(items, total?.n ?? 0, params);
  }

  /** Queues a failed automation send again (system e-mails are not stored, so they cannot be resent). */
  async retry(actor: Actor, id: string) {
    assertCan(actor, 'mail.manage');
    if (!this.deps.jobs) throw AppError.unavailable('La cola de trabajos no está disponible');
    const [d] = await this.deps.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, id));
    if (!d) throw AppError.notFound('Envío');
    if (d.status !== 'failed' || !d.automationId) throw AppError.conflict('Solo se reintentan envíos fallidos de automatizaciones');
    await this.deps.db.update(mailDeliveries).set({ status: 'queued', error: null, scheduledFor: new Date() }).where(eq(mailDeliveries.id, id));
    await this.deps.jobs.send(QUEUES.mailSend, { deliveryId: id }, { idempotencyKey: `${id}:${d.attempts}` });
    await recordAudit(this.deps.db, actor, { action: 'mail.deliveries.retry', resourceType: 'mail_delivery', resourceId: id, outcome: 'success', organizationId: null });
    return { ok: true as const };
  }
}
