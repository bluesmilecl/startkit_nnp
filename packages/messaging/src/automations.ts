import { SettingsService, assertCan, recordAudit, type Actor } from '@starter/auth';
import { featureFlags } from '@starter/config';
import { AppError, AUTOMATION_VARIABLES, MAIL_EVENTS, sampleMailData, type MailAutomation, type MailAutomationInput, type MailEventKey, type UpdateMailAutomationInput } from '@starter/contracts';
import {
  and,
  asc,
  auditEvents,
  count,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  isUniqueViolation,
  lte,
  mailAutomations,
  mailDeliveries,
  mailTemplates,
  or,
  roles,
  sql,
  userRoles,
  users,
} from '@starter/db';
import { createLogger } from '@starter/observability';
import { CronExpressionParser } from 'cron-parser';
import type { MessagingDeps } from './context.js';

const log = createLogger('mail-automations');
const CURSOR_KEY = 'mail.automations.cursor';
const BATCH = 500;
/**
 * Events are read only once they are this old: an audit row is stamped when its transaction
 * starts, so a tick must not move past it before that transaction can have committed.
 */
export const AUTOMATION_SETTLE_MS = 15_000;
const ZERO_ID = '00000000-0000-0000-0000-000000000000';

type AutomationRow = typeof mailAutomations.$inferSelect;
type EventRow = typeof auditEvents.$inferSelect;
interface Recipient {
  email: string;
  name: string | null;
}

export function nextRun(cron: string, from = new Date()): Date {
  try {
    return CronExpressionParser.parse(cron, { currentDate: from, tz: 'UTC' }).next().toDate();
  } catch {
    throw AppError.field('cron', 'Expresión cron inválida (5 campos, hora UTC)');
  }
}

function rethrowNameTaken(err: unknown): never {
  if (isUniqueViolation(err, 'mail_automations_name_uq')) throw AppError.field('name', 'Ya existe una automatización con ese nombre', 'CONFLICT');
  throw err;
}

/**
 * Automations send a template when an audited action happens (users.register, projects.create…)
 * or on a cron schedule. Audit events are the event source: every module already records them,
 * so new modules become triggers by adding their action to MAIL_EVENTS. Sends are durable jobs.
 */
export class MailAutomationsService {
  private readonly settings: SettingsService;

  constructor(private readonly deps: MessagingDeps) {
    this.settings = new SettingsService({ db: deps.db, env: deps.env, mailer: deps.mailer, features: featureFlags(deps.env) });
  }

  private async rows(where?: ReturnType<typeof eq>) {
    const rows = await this.deps.db
      .select({ a: mailAutomations, t: { id: mailTemplates.id, key: mailTemplates.key, name: mailTemplates.name } })
      .from(mailAutomations)
      .innerJoin(mailTemplates, eq(mailTemplates.id, mailAutomations.templateId))
      .where(where)
      .orderBy(asc(mailAutomations.name));
    const counts = await this.deps.db
      .select({ id: mailDeliveries.automationId, n: count() })
      .from(mailDeliveries)
      .where(and(sql`${mailDeliveries.automationId} is not null`, gt(mailDeliveries.createdAt, sql`now() - interval '7 days'`)))
      .groupBy(mailDeliveries.automationId);
    const byId = new Map(counts.map((c) => [c.id, c.n]));
    return rows.map(({ a, t }): MailAutomation => ({
      id: a.id,
      name: a.name,
      description: a.description,
      trigger: a.trigger as MailAutomation['trigger'],
      cron: a.cron,
      template: t,
      recipientKind: a.recipientKind,
      recipientRoleKey: a.recipientRoleKey,
      recipientEmails: a.recipientEmails,
      delayMinutes: a.delayMinutes,
      enabled: a.enabled,
      lastRunAt: a.lastRunAt?.toISOString() ?? null,
      nextRunAt: a.nextRunAt?.toISOString() ?? null,
      deliveries7d: byId.get(a.id) ?? 0,
      version: a.version,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }));
  }

  private async load(id: string): Promise<MailAutomation> {
    const [a] = await this.rows(eq(mailAutomations.id, id));
    if (!a) throw AppError.notFound('Automatización', 'f');
    return a;
  }

  async list(actor: Actor) {
    assertCan(actor, 'mail.read');
    return this.rows();
  }

  async get(actor: Actor, id: string) {
    assertCan(actor, 'mail.read');
    return this.load(id);
  }

  private async validate(input: Pick<MailAutomationInput, 'templateId' | 'recipientKind' | 'recipientRoleKey'>) {
    const [tpl] = await this.deps.db.select({ id: mailTemplates.id }).from(mailTemplates).where(eq(mailTemplates.id, input.templateId));
    if (!tpl) throw AppError.field('templateId', 'La plantilla no existe');
    if (input.recipientKind === 'role') {
      const [role] = await this.deps.db.select({ id: roles.id }).from(roles).where(and(eq(roles.key, input.recipientRoleKey ?? ''), isNull(roles.organizationId)));
      if (!role) throw AppError.field('recipientRoleKey', 'El rol no existe');
    }
  }

  private fields(input: MailAutomationInput) {
    const schedule = input.trigger === 'schedule';
    return {
      name: input.name,
      description: input.description ?? null,
      trigger: input.trigger,
      cron: schedule ? (input.cron ?? null) : null,
      templateId: input.templateId,
      recipientKind: input.recipientKind,
      recipientRoleKey: input.recipientKind === 'role' ? (input.recipientRoleKey ?? null) : null,
      recipientEmails: input.recipientKind === 'emails' ? (input.recipientEmails ?? []) : [],
      delayMinutes: input.delayMinutes,
      enabled: input.enabled,
      nextRunAt: schedule && input.cron ? nextRun(input.cron) : null,
    };
  }

  async create(actor: Actor, input: MailAutomationInput) {
    assertCan(actor, 'mail.manage');
    await this.validate(input);
    const [row] = await this.deps.db
      .insert(mailAutomations)
      .values({ ...this.fields(input), enabledAt: input.enabled ? new Date() : null, createdBy: actor.userId, updatedBy: actor.userId })
      .returning()
      .catch(rethrowNameTaken);
    await recordAudit(this.deps.db, actor, { action: 'mail.automations.create', resourceType: 'mail_automation', resourceId: row!.id, outcome: 'success', organizationId: null, after: { name: row!.name, trigger: row!.trigger, enabled: row!.enabled } });
    return this.load(row!.id);
  }

  async update(actor: Actor, id: string, input: UpdateMailAutomationInput) {
    assertCan(actor, 'mail.manage');
    const [before] = await this.deps.db.select().from(mailAutomations).where(eq(mailAutomations.id, id));
    if (!before) throw AppError.notFound('Automatización', 'f');
    await this.validate(input);
    // Turning it on never replays what happened while it was off.
    const enabledAt = input.enabled && !before.enabled ? new Date() : input.enabled ? before.enabledAt : null;
    const [row] = await this.deps.db
      .update(mailAutomations)
      .set({ ...this.fields(input), enabledAt, updatedBy: actor.userId, version: sql`${mailAutomations.version} + 1` as unknown as number })
      .where(and(eq(mailAutomations.id, id), eq(mailAutomations.version, input.version)))
      .returning()
      .catch(rethrowNameTaken);
    if (!row) throw AppError.precondition('La automatización fue modificada por otra persona; recarga para ver los cambios', { currentVersion: before.version });
    await recordAudit(this.deps.db, actor, {
      action: 'mail.automations.update',
      resourceType: 'mail_automation',
      resourceId: id,
      outcome: 'success',
      organizationId: null,
      before: { name: before.name, trigger: before.trigger, enabled: before.enabled, templateId: before.templateId },
      after: { name: row.name, trigger: row.trigger, enabled: row.enabled, templateId: row.templateId },
    });
    return this.load(id);
  }

  async remove(actor: Actor, id: string) {
    assertCan(actor, 'mail.manage');
    const [before] = await this.deps.db.select().from(mailAutomations).where(eq(mailAutomations.id, id));
    if (!before) throw AppError.notFound('Automatización', 'f');
    await this.deps.db.delete(mailAutomations).where(eq(mailAutomations.id, id));
    await recordAudit(this.deps.db, actor, { action: 'mail.automations.delete', resourceType: 'mail_automation', resourceId: id, outcome: 'success', organizationId: null, before: { name: before.name, trigger: before.trigger } });
  }

  /** Sends the automation's template once, with sample event values, to one address. */
  async test(actor: Actor, id: string, input: { to: string }) {
    assertCan(actor, 'mail.manage');
    const a = await this.load(id);
    const data = sampleMailData(AUTOMATION_VARIABLES, { 'recipient.email': input.to, 'event.label': a.trigger === 'schedule' ? a.name : MAIL_EVENTS[a.trigger].label });
    const rendered = await this.deps.mailer.render(a.template.key, data);
    if (!rendered) throw AppError.notFound('Plantilla', 'f');
    const result = await this.deps.mailer
      .send({ to: input.to, ...rendered, category: 'test', template: { key: a.template.key, data } })
      .then((r) => ({ ok: true, messageId: r.id, detail: null }), (err: unknown) => ({ ok: false, messageId: null, detail: (err as Error).message }));
    await recordAudit(this.deps.db, actor, { action: 'mail.automations.test', resourceType: 'mail_automation', resourceId: id, outcome: result.ok ? 'success' : 'failed', organizationId: null, metadata: { to: input.to } });
    return result;
  }

  // ── worker ───────────────────────────────────────────────────────────────────────────────

  /**
   * Turns new audit events and due schedules into queued deliveries (idempotent per automation,
   * event and recipient) and returns them for the caller to enqueue.
   */
  async tick(now = new Date()): Promise<{ events: number; queued: { id: string; startAfter: Date }[] }> {
    const horizon = new Date(now.getTime() - AUTOMATION_SETTLE_MS);
    const cursor = await this.settings.getRaw<{ at: string; id: string }>(CURSOR_KEY);
    if (!cursor) {
      // First run: start from now (an installation never replays its history).
      await this.settings.setRaw(CURSOR_KEY, { at: horizon.toISOString(), id: ZERO_ID }, null);
      return { events: 0, queued: [] };
    }
    const active = await this.deps.db.select().from(mailAutomations).where(eq(mailAutomations.enabled, true));
    const queued: { id: string; startAfter: Date }[] = [];
    const byTrigger = new Map<string, AutomationRow[]>();
    for (const a of active) if (a.trigger !== 'schedule') byTrigger.set(a.trigger, [...(byTrigger.get(a.trigger) ?? []), a]);

    let events: (EventRow & { at: string })[] = [];
    if (byTrigger.size) {
      // The cursor keeps PostgreSQL's microseconds (a JS Date would round them and re-read the last event).
      const at = sql`${cursor.at}::timestamptz`;
      events = await this.deps.db
        .select({ ...getTableColumns(auditEvents), at: sql<string>`${auditEvents.occurredAt}::text` })
        .from(auditEvents)
        .where(
          and(
            or(gt(auditEvents.occurredAt, at), and(eq(auditEvents.occurredAt, at), gt(auditEvents.id, cursor.id))),
            lte(auditEvents.occurredAt, horizon),
            inArray(auditEvents.action, [...byTrigger.keys()]),
            eq(auditEvents.outcome, 'success'),
          ),
        )
        .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id))
        .limit(BATCH);
      for (const e of events) {
        for (const a of byTrigger.get(e.action) ?? []) {
          if (!a.enabledAt || a.enabledAt > e.occurredAt) continue;
          const data = await this.eventData(e);
          for (const r of await this.recipients(a, e)) {
            const startAfter = new Date(Math.max(now.getTime(), e.occurredAt.getTime() + a.delayMinutes * 60_000));
            const id = await this.enqueue(a, `${a.id}:${e.id}:${r.email}`, r, data, startAfter);
            if (id) queued.push({ id, startAfter });
          }
        }
      }
    }
    // Without matching events the cursor still moves, so the next query stays small.
    const last = events.at(-1);
    await this.settings.setRaw(CURSOR_KEY, last ? { at: last.at, id: last.id } : { at: horizon.toISOString(), id: ZERO_ID }, null);

    for (const a of active.filter((x) => x.trigger === 'schedule' && x.cron && x.nextRunAt && x.nextRunAt <= now)) {
      const due = a.nextRunAt!;
      const data = { event: { label: a.name, action: 'schedule', date: await this.formatDate(due) }, actor: { name: '', email: '' }, resource: { type: 'schedule', id: a.id, name: a.name } };
      for (const r of await this.recipients(a, null)) {
        const startAfter = new Date(now.getTime() + a.delayMinutes * 60_000);
        const id = await this.enqueue(a, `${a.id}:${due.toISOString()}:${r.email}`, r, data, startAfter);
        if (id) queued.push({ id, startAfter });
      }
      await this.deps.db.update(mailAutomations).set({ lastRunAt: now, nextRunAt: nextRun(a.cron!, now) }).where(eq(mailAutomations.id, a.id));
    }
    if (queued.length) log.info({ events: events.length, queued: queued.length }, 'automation deliveries queued');
    return { events: events.length, queued };
  }

  private async enqueue(a: AutomationRow, dedupeKey: string, r: Recipient, data: Record<string, unknown>, startAfter: Date): Promise<string | null> {
    const [row] = await this.deps.db
      .insert(mailDeliveries)
      .values({
        status: 'queued',
        toAddress: r.email,
        templateKey: null,
        category: 'automation',
        automationId: a.id,
        dedupeKey,
        data: { ...data, recipient: { name: r.name ?? '', email: r.email } },
        scheduledFor: startAfter,
      })
      .onConflictDoNothing()
      .returning({ id: mailDeliveries.id });
    if (row) await this.deps.db.update(mailAutomations).set({ lastRunAt: new Date() }).where(eq(mailAutomations.id, a.id));
    return row?.id ?? null;
  }

  private async recipients(a: AutomationRow, e: EventRow | null): Promise<Recipient[]> {
    const userById = async (id: string | null | undefined) => {
      if (!id) return [];
      const [u] = await this.deps.db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, id));
      return u ? [u] : [];
    };
    switch (a.recipientKind) {
      case 'emails':
        return a.recipientEmails.map((email) => ({ email, name: null }));
      case 'role':
        return this.deps.db
          .selectDistinct({ email: users.email, name: users.name })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(and(eq(roles.key, a.recipientRoleKey ?? ''), isNull(users.disabledAt)));
      case 'actor':
        return userById(e?.actorUserId);
      case 'subject': {
        if (!e) return [];
        const person = MAIL_EVENTS[e.action as MailEventKey]?.person;
        if (person === 'user') return userById(e.resourceId);
        if (person === 'session') return userById((e.metadata as { userId?: string } | null)?.userId);
        if (person === 'invitation') {
          const email = (e.after as { email?: string } | null)?.email;
          return email ? [{ email, name: null }] : [];
        }
        return [];
      }
    }
  }

  private async formatDate(d: Date): Promise<string> {
    const locale = (await this.settings.getRaw<{ locale?: string; timezone?: string }>('locale')) ?? {};
    return new Intl.DateTimeFormat(locale.locale ?? 'es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: locale.timezone ?? 'America/Santiago' }).format(d);
  }

  /** Template variables for an audit event (names only; never before/after payloads). */
  private async eventData(e: EventRow): Promise<Record<string, unknown>> {
    const [actor] = e.actorUserId ? await this.deps.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, e.actorUserId)) : [];
    const after = (e.after ?? {}) as { name?: string; email?: string };
    const before = (e.before ?? {}) as { name?: string; email?: string };
    const meta = (e.metadata ?? {}) as { filename?: string };
    return {
      event: { label: MAIL_EVENTS[e.action as MailEventKey]?.label ?? e.action, action: e.action, date: await this.formatDate(e.occurredAt) },
      actor: { name: actor?.name ?? '', email: actor?.email ?? '' },
      resource: { type: e.resourceType, id: e.resourceId ?? '', name: after.name ?? before.name ?? after.email ?? meta.filename ?? '' },
    };
  }

  /** Sends one queued delivery (mail.send job). Already sent or skipped rows are left alone. */
  async deliver(deliveryId: string): Promise<'sent' | 'skipped'> {
    const [d] = await this.deps.db.select().from(mailDeliveries).where(eq(mailDeliveries.id, deliveryId));
    if (!d || d.status === 'sent' || d.status === 'skipped') return 'skipped';
    const [a] = d.automationId
      ? await this.deps.db
          .select({ enabled: mailAutomations.enabled, key: mailTemplates.key })
          .from(mailAutomations)
          .innerJoin(mailTemplates, eq(mailTemplates.id, mailAutomations.templateId))
          .where(eq(mailAutomations.id, d.automationId))
      : [];
    if (!a || !a.enabled) {
      await this.deps.db.update(mailDeliveries).set({ status: 'skipped', error: a ? 'La automatización se desactivó antes del envío' : 'La automatización ya no existe' }).where(eq(mailDeliveries.id, d.id));
      return 'skipped';
    }
    const data = d.data ?? {};
    const rendered = await this.deps.mailer.render(a.key, data);
    if (!rendered) {
      await this.deps.db.update(mailDeliveries).set({ status: 'skipped', error: 'La plantilla ya no existe' }).where(eq(mailDeliveries.id, d.id));
      return 'skipped';
    }
    await this.deps.db.update(mailDeliveries).set({ templateKey: a.key }).where(eq(mailDeliveries.id, d.id));
    // ConfiguredMailer records the result on this row; a failure propagates so the job retries.
    await this.deps.mailer.send({ to: d.toAddress, ...rendered, category: 'automation', template: { key: a.key, data }, deliveryId: d.id });
    return 'sent';
  }
}
