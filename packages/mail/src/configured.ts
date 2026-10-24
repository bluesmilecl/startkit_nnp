import type { Env, SecretBox } from '@starter/config';
import { renderMailTemplate } from '@starter/contracts';
import { and, eq, isNull, mailAutomations, mailDeliveries, mailSettings, mailTemplates, settings, sql, type Database } from '@starter/db';
import { createLogger, sanitizeError } from '@starter/observability';
import { DEFAULT_MAIL_AUTOMATIONS, DEFAULT_MAIL_TEMPLATES } from './defaults.js';
import { createMailer, type MailCheck, type MailEnv, type Mailer, type MailMessage } from './mailer.js';

const log = createLogger('mail');

export type MailSettingsRow = typeof mailSettings.$inferSelect;
type TemplateRow = typeof mailTemplates.$inferSelect;

/** Provider environment for a stored configuration (secret already decrypted, kept in memory only). */
export function mailEnvFromSettings(env: Pick<Env, 'NODE_ENV' | 'SMTP_URL'>, s: Pick<MailSettingsRow, 'transport' | 'fromAddress' | 'config'>, secret: string | null): MailEnv {
  const c = s.config ?? {};
  const t = s.transport as MailEnv['MAIL_TRANSPORT'];
  return {
    NODE_ENV: env.NODE_ENV,
    MAIL_TRANSPORT: t,
    MAIL_FROM: s.fromAddress,
    SMTP_URL: env.SMTP_URL,
    SMTP_HOST: t === 'smtp' ? (c.smtpHost ?? undefined) : undefined,
    SMTP_PORT: t === 'smtp' ? (c.smtpPort ?? undefined) : undefined,
    SMTP_USER: t === 'smtp' ? (c.smtpUser ?? undefined) : undefined,
    SMTP_PASSWORD: t === 'smtp' ? (secret ?? undefined) : undefined,
    SMTP_SECURE: t === 'smtp' ? (c.smtpSecure ?? undefined) : undefined,
    RESEND_API_KEY: t === 'resend' ? (secret ?? undefined) : undefined,
    POSTMARK_SERVER_TOKEN: t === 'postmark' ? (secret ?? undefined) : undefined,
    SENDGRID_API_KEY: t === 'sendgrid' ? (secret ?? undefined) : undefined,
    MAILGUN_API_KEY: t === 'mailgun' ? (secret ?? undefined) : undefined,
    MAILGUN_DOMAIN: t === 'mailgun' ? (c.mailgunDomain ?? undefined) : undefined,
    MAILGUN_REGION: c.mailgunRegion ?? 'us',
    BREVO_API_KEY: t === 'brevo' ? (secret ?? undefined) : undefined,
  };
}

export interface ConfiguredMailerDeps {
  env: Env;
  db: Database;
  secrets: SecretBox;
  /** How long provider settings and templates are cached (other processes pick up changes after it). */
  cacheMs?: number;
}

interface ResolvedProvider {
  at: number;
  mailer: Mailer;
  transport: string;
  replyTo: string | null;
  source: 'database' | 'environment';
}

/**
 * The platform mailer (API and worker): provider from /admin/mail (or the MAIL_* variables when
 * nothing is stored), editable templates by key, and a mail_deliveries row for every send.
 * Sending never depends on the log: a failure to record is only logged.
 */
export class ConfiguredMailer implements Mailer {
  private provider: ResolvedProvider | null = null;
  private readonly templates = new Map<string, { at: number; row: TemplateRow | null }>();
  private readonly ttl: number;

  constructor(private readonly deps: ConfiguredMailerDeps) {
    this.ttl = deps.cacheMs ?? 15_000;
  }

  get transport(): string {
    return this.provider?.transport ?? this.deps.env.MAIL_TRANSPORT;
  }

  /** Forget cached settings and templates (called after changes in this process). */
  invalidate(): void {
    this.provider = null;
    this.templates.clear();
  }

  async resolve(): Promise<ResolvedProvider> {
    if (this.provider && Date.now() - this.provider.at < this.ttl) return this.provider;
    const row = await this.deps.db
      .select()
      .from(mailSettings)
      .where(eq(mailSettings.key, 'default'))
      .limit(1)
      .then((r) => r[0] ?? null)
      .catch((err: unknown) => {
        log.warn({ err: sanitizeError(err) }, 'mail settings unavailable; using MAIL_* variables');
        return null;
      });
    if (row) {
      const secret = row.secretCiphertext ? this.deps.secrets.decrypt(row.secretCiphertext) : null;
      this.provider = { at: Date.now(), mailer: createMailer(mailEnvFromSettings(this.deps.env, row, secret)), transport: row.transport, replyTo: row.replyTo, source: 'database' };
    } else {
      this.provider = { at: Date.now(), mailer: createMailer(this.deps.env), transport: this.deps.env.MAIL_TRANSPORT, replyTo: null, source: 'environment' };
    }
    return this.provider;
  }

  async verify(): Promise<MailCheck> {
    return (await this.resolve()).mailer.verify();
  }

  async send(m: MailMessage): Promise<{ id: string | null }> {
    const p = await this.resolve();
    let message: MailMessage = { ...m, replyTo: m.replyTo ?? p.replyTo };
    if (m.template) {
      try {
        const rendered = await this.render(m.template.key, m.template.data);
        if (rendered) message = { ...message, ...rendered };
      } catch (err) {
        // A broken template must never block access codes: the built-in content is sent instead.
        log.warn({ template: m.template.key, err: sanitizeError(err) }, 'template failed; using built-in content');
      }
    }
    try {
      const r = await p.mailer.send(message);
      await this.record(m, { status: 'sent', messageId: r.id, transport: p.transport, error: null });
      return r;
    } catch (err) {
      await this.record(m, { status: 'failed', messageId: null, transport: p.transport, error: describeError(err) });
      throw err;
    }
  }

  /** Renders the stored template `key` with branding + data, or null when it does not exist. */
  async render(key: string, data: Record<string, unknown>): Promise<{ subject: string; html: string; text: string } | null> {
    const tpl = await this.template(key);
    if (!tpl) return null;
    const r = renderMailTemplate(tpl, { ...(await this.baseData()), ...data });
    return { subject: r.subject, html: r.html, text: r.text };
  }

  /** Variables every template receives: branding from Configuración plus APP_URL and the year. */
  async baseData(): Promise<Record<string, unknown>> {
    const [row] = await this.deps.db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.key, 'branding'), isNull(settings.organizationId)))
      .limit(1)
      .catch(() => []);
    const b = (row?.value ?? {}) as { appName?: string; primaryColor?: string; logoUrl?: string | null; supportEmail?: string | null };
    return {
      appName: b.appName ?? this.deps.env.APP_NAME,
      appUrl: this.deps.env.APP_URL.replace(/\/$/, ''),
      primaryColor: b.primaryColor ?? '#2563eb',
      logoUrl: b.logoUrl ?? '',
      supportEmail: b.supportEmail ?? '',
      year: String(new Date().getFullYear()),
    };
  }

  private async template(key: string): Promise<TemplateRow | null> {
    const hit = this.templates.get(key);
    if (hit && Date.now() - hit.at < this.ttl) return hit.row;
    const [row] = await this.deps.db.select().from(mailTemplates).where(eq(mailTemplates.key, key)).limit(1);
    this.templates.set(key, { at: Date.now(), row: row ?? null });
    return row ?? null;
  }

  private async record(m: MailMessage, r: { status: 'sent' | 'failed'; messageId: string | null; transport: string; error: string | null }): Promise<void> {
    try {
      if (m.deliveryId) {
        await this.deps.db
          .update(mailDeliveries)
          .set({ status: r.status, messageId: r.messageId, transport: r.transport, error: r.error, attempts: sql`${mailDeliveries.attempts} + 1`, sentAt: r.status === 'sent' ? new Date() : null })
          .where(eq(mailDeliveries.id, m.deliveryId));
      } else {
        await this.deps.db.insert(mailDeliveries).values({
          status: r.status,
          toAddress: m.to,
          templateKey: m.template?.key ?? null,
          category: m.category,
          transport: r.transport,
          messageId: r.messageId,
          error: r.error,
          attempts: 1,
          sentAt: r.status === 'sent' ? new Date() : null,
        });
      }
    } catch (err) {
      log.warn({ err: sanitizeError(err), category: m.category }, 'mail delivery not recorded');
    }
  }
}

/** Safe, short description of a send failure (catalog message plus the provider's reason). */
export function describeError(err: unknown): string {
  const e = err as Error & { cause?: unknown };
  const cause = e.cause instanceof Error ? e.cause.message : null;
  return [e.message, cause].filter(Boolean).join(' · ').slice(0, 500);
}

/**
 * Creates the system templates that do not exist yet (edited ones are never overwritten) and,
 * once per installation, the default automations (disabled). Called by `pnpm db:migrate`.
 */
export async function syncMailTemplates(db: Database): Promise<{ templatesCreated: number; automationsCreated: number }> {
  const created = await db
    .insert(mailTemplates)
    .values(DEFAULT_MAIL_TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, kind: 'system' as const, subject: t.subject, html: t.html, text: t.text, variables: t.variables })))
    .onConflictDoNothing({ target: mailTemplates.key })
    .returning({ id: mailTemplates.id });
  let automationsCreated = 0;
  const [seeded] = await db.select().from(settings).where(and(eq(settings.key, 'mail.seeded'), isNull(settings.organizationId))).limit(1);
  if (!seeded) {
    for (const a of DEFAULT_MAIL_AUTOMATIONS) {
      const [tpl] = await db.select({ id: mailTemplates.id }).from(mailTemplates).where(eq(mailTemplates.key, a.templateKey)).limit(1);
      if (!tpl) continue;
      const rows = await db
        .insert(mailAutomations)
        .values({ name: a.name, description: a.description, trigger: a.trigger, templateId: tpl.id, recipientKind: a.recipientKind, enabled: false })
        .onConflictDoNothing()
        .returning({ id: mailAutomations.id });
      automationsCreated += rows.length;
    }
    await db.insert(settings).values({ key: 'mail.seeded', value: { at: new Date().toISOString() }, organizationId: null }).onConflictDoNothing();
  }
  return { templatesCreated: created.length, automationsCreated };
}
