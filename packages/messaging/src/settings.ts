import { isPublicAddress } from '@starter/ai';
import { assertCan, recordAudit, type Actor } from '@starter/auth';
import { maskSecret } from '@starter/config';
import { AppError, type MailProviderInput, type MailProviderSettings } from '@starter/contracts';
import { and, eq, mailDeliveries, mailSettings, type MailProviderConfig } from '@starter/db';
import { createMailer, describeError, mailEnvFromSettings, type Mailer, type MailSettingsRow } from '@starter/mail';
import ipaddr from 'ipaddr.js';
import { lookup } from 'node:dns/promises';
import type { MessagingDeps } from './context.js';

const KEY = 'default';
const SECRET_LABEL: Record<string, string> = { resend: 'API key de Resend', smtp: 'contraseña SMTP', postmark: 'Server token de Postmark', sendgrid: 'API key de SendGrid', mailgun: 'API key de Mailgun', brevo: 'API key de Brevo' };
const NEEDS_SECRET = new Set(['resend', 'postmark', 'sendgrid', 'mailgun', 'brevo']);

function configOf(p: MailProviderInput): MailProviderConfig {
  if (p.transport === 'smtp') return { smtpHost: p.smtpHost ?? null, smtpPort: p.smtpPort ?? null, smtpUser: p.smtpUser ?? null, smtpSecure: p.smtpSecure ?? null };
  if (p.transport === 'mailgun') return { mailgunDomain: p.mailgunDomain ?? null, mailgunRegion: p.mailgunRegion ?? 'us' };
  return {};
}

/** What the audit trail keeps: the configuration without the secret (only whether it changed). */
function summary(row: MailSettingsRow | null) {
  return row ? { transport: row.transport, from: row.fromAddress, replyTo: row.replyTo, config: row.config, secretHint: row.secretHint } : { source: 'environment' };
}

export function testMessage(appName: string, transport: string) {
  const subject = `Prueba de correo · ${appName}`;
  const text = `Este es un correo de prueba de ${appName} enviado con ${transport}. Si lo recibiste, los códigos de acceso, invitaciones y automatizaciones también llegarán.`;
  const html = `<p>Este es un correo de prueba de <strong>${appName.replace(/[<>&]/g, '')}</strong> enviado con ${transport}.</p><p>Si lo recibiste, los códigos de acceso, invitaciones y automatizaciones también llegarán.</p>`;
  return { subject, html, text };
}

/**
 * Mail provider configured from the panel. The API key or SMTP password is encrypted with
 * APP_ENCRYPTION_KEY and never returned (only a hint). Without a stored row the MAIL_* variables
 * apply; `reset` goes back to them.
 */
export class MailSettingsService {
  constructor(private readonly deps: MessagingDeps) {}

  private async row(): Promise<MailSettingsRow | null> {
    const [row] = await this.deps.db.select().from(mailSettings).where(eq(mailSettings.key, KEY)).limit(1);
    return row ?? null;
  }

  private view(row: MailSettingsRow | null): MailProviderSettings {
    const env = this.deps.env;
    const environment = { transport: env.MAIL_TRANSPORT, from: env.MAIL_FROM };
    if (!row) {
      const smtpHost = env.MAIL_TRANSPORT === 'smtp' ? (env.SMTP_HOST ?? hostOf(env.SMTP_URL)) : null;
      return {
        source: 'environment',
        transport: env.MAIL_TRANSPORT,
        from: env.MAIL_FROM,
        replyTo: null,
        smtpHost,
        smtpPort: env.MAIL_TRANSPORT === 'smtp' ? (env.SMTP_PORT ?? portOf(env.SMTP_URL)) : null,
        smtpUser: env.MAIL_TRANSPORT === 'smtp' ? (env.SMTP_USER ?? null) : null,
        smtpSecure: env.MAIL_TRANSPORT === 'smtp' ? (env.SMTP_SECURE ?? null) : null,
        mailgunDomain: env.MAILGUN_DOMAIN ?? null,
        mailgunRegion: env.MAIL_TRANSPORT === 'mailgun' ? env.MAILGUN_REGION : null,
        hasSecret: false,
        secretHint: null,
        environment,
        lastCheck: null,
        version: 0,
        updatedAt: null,
      };
    }
    const c = row.config ?? {};
    return {
      source: 'database',
      transport: row.transport as MailProviderSettings['transport'],
      from: row.fromAddress,
      replyTo: row.replyTo,
      smtpHost: c.smtpHost ?? null,
      smtpPort: c.smtpPort ?? null,
      smtpUser: c.smtpUser ?? null,
      smtpSecure: c.smtpSecure ?? null,
      mailgunDomain: c.mailgunDomain ?? null,
      mailgunRegion: c.mailgunRegion ?? null,
      hasSecret: !!row.secretCiphertext,
      secretHint: row.secretHint,
      environment,
      lastCheck: row.lastCheckAt ? { at: row.lastCheckAt.toISOString(), ok: !!row.lastCheckOk, detail: row.lastCheckDetail } : null,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async get(actor: Actor): Promise<MailProviderSettings> {
    assertCan(actor, 'mail.read');
    return this.view(await this.row());
  }

  /** A private SMTP host (internal relay, Mailpit) is fine outside production or when explicitly allowed. */
  private async assertHostAllowed(p: MailProviderInput): Promise<void> {
    if (p.transport !== 'smtp' || !p.smtpHost) return;
    if (this.deps.env.NODE_ENV !== 'production' || this.deps.env.MAIL_ALLOW_PRIVATE_HOSTS) return;
    const host = p.smtpHost.replace(/^\[|\]$/g, '');
    const addresses = ipaddr.isValid(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (!addresses.length) throw AppError.field('smtpHost', 'No se pudo resolver el servidor SMTP');
    if (addresses.some((a) => !isPublicAddress(a.address))) {
      throw AppError.field('smtpHost', 'El servidor SMTP está en una red privada; para permitirlo define MAIL_ALLOW_PRIVATE_HOSTS=true');
    }
  }

  /** Mailer for a form that was not saved yet (the stored secret is reused when the provider is the same). */
  private async draftMailer(draft: MailProviderInput): Promise<{ mailer: Mailer; transport: string; replyTo: string | null }> {
    await this.assertHostAllowed(draft);
    const row = await this.row();
    const stored = row && row.transport === draft.transport && row.secretCiphertext ? this.deps.secrets.decrypt(row.secretCiphertext) : null;
    const secret = draft.secret ?? stored;
    if (NEEDS_SECRET.has(draft.transport) && !secret) throw AppError.field('secret', `Ingresa la ${SECRET_LABEL[draft.transport]}`);
    const mailer = createMailer(mailEnvFromSettings(this.deps.env, { transport: draft.transport, fromAddress: draft.from, config: configOf(draft) }, secret));
    return { mailer, transport: draft.transport, replyTo: draft.replyTo ?? null };
  }

  async update(actor: Actor, input: { provider: MailProviderInput; version: number }): Promise<MailProviderSettings> {
    assertCan(actor, 'mail.manage');
    const p = input.provider;
    const before = await this.row();
    const stale = () => AppError.precondition('La configuración de correo cambió; recarga para ver los cambios', { currentVersion: before?.version ?? 0 });
    if ((before?.version ?? 0) !== input.version) throw stale();
    await this.assertHostAllowed(p);
    // A stored key belongs to its provider: changing provider without a new key clears it.
    const keep = !p.secret && !!before?.secretCiphertext && before.transport === p.transport;
    if (NEEDS_SECRET.has(p.transport) && !p.secret && !keep) throw AppError.field('secret', `Ingresa la ${SECRET_LABEL[p.transport]}`);
    const secretFields = p.secret ? { secretCiphertext: this.deps.secrets.encrypt(p.secret), secretHint: maskSecret(p.secret) } : keep ? {} : { secretCiphertext: null, secretHint: null };
    const values = {
      transport: p.transport,
      fromAddress: p.from,
      replyTo: p.replyTo ?? null,
      config: configOf(p),
      ...secretFields,
      lastCheckAt: null,
      lastCheckOk: null,
      lastCheckDetail: null,
      updatedBy: actor.userId,
    };
    const [after] = before
      ? await this.deps.db
          .update(mailSettings)
          .set({ ...values, version: before.version + 1 })
          .where(and(eq(mailSettings.key, KEY), eq(mailSettings.version, input.version)))
          .returning()
      : await this.deps.db
          .insert(mailSettings)
          .values({ key: KEY, ...values, version: 1 })
          .onConflictDoNothing()
          .returning();
    if (!after) throw stale();
    this.deps.mailer.invalidate();
    await recordAudit(this.deps.db, actor, {
      action: 'mail.settings.update',
      resourceType: 'mail_settings',
      resourceId: KEY,
      outcome: 'success',
      organizationId: null,
      before: summary(before),
      after: summary(after),
      metadata: { keyReplaced: !!p.secret },
    });
    return this.view(after);
  }

  /** Back to the MAIL_* variables (the stored configuration and secret are deleted). */
  async reset(actor: Actor): Promise<MailProviderSettings> {
    assertCan(actor, 'mail.manage');
    const before = await this.row();
    await this.deps.db.delete(mailSettings).where(eq(mailSettings.key, KEY));
    this.deps.mailer.invalidate();
    await recordAudit(this.deps.db, actor, { action: 'mail.settings.reset', resourceType: 'mail_settings', resourceId: KEY, outcome: 'success', organizationId: null, before: summary(before), after: summary(null) });
    return this.view(null);
  }

  /** Checks credentials without sending (the form's values, or what is in use). */
  async check(actor: Actor, input: { draft?: MailProviderInput }) {
    assertCan(actor, 'mail.manage');
    const { mailer, transport } = input.draft ? await this.draftMailer(input.draft) : { ...(await this.deps.mailer.resolve()) };
    const r = await mailer.verify();
    const at = new Date();
    if (!input.draft) {
      await this.deps.db.update(mailSettings).set({ lastCheckAt: at, lastCheckOk: r.ok, lastCheckDetail: r.detail }).where(eq(mailSettings.key, KEY));
    }
    await recordAudit(this.deps.db, actor, { action: 'mail.settings.check', resourceType: 'mail_settings', resourceId: KEY, outcome: r.ok ? 'success' : 'failed', organizationId: null, metadata: { transport, draft: !!input.draft } });
    return { ok: r.ok, detail: r.detail, at: at.toISOString() };
  }

  /** Sends a real test e-mail and reports the provider's answer (never throws for a rejected send). */
  async test(actor: Actor, input: { to: string; draft?: MailProviderInput }) {
    assertCan(actor, 'mail.manage');
    const base = await this.deps.mailer.baseData();
    let result: { ok: boolean; messageId: string | null; detail: string | null };
    if (!input.draft) {
      const p = await this.deps.mailer.resolve();
      result = await this.deps.mailer
        .send({ to: input.to, ...testMessage(String(base.appName), p.transport), category: 'test' })
        .then((r) => ({ ok: true, messageId: r.id, detail: null }), (err: unknown) => ({ ok: false, messageId: null, detail: describeError(err) }));
    } else {
      const { mailer, transport, replyTo } = await this.draftMailer(input.draft);
      result = await mailer
        .send({ to: input.to, ...testMessage(String(base.appName), transport), category: 'test', replyTo })
        .then((r) => ({ ok: true, messageId: r.id, detail: null }), (err: unknown) => ({ ok: false, messageId: null, detail: describeError(err) }));
      await this.deps.db.insert(mailDeliveries).values({
        status: result.ok ? 'sent' : 'failed',
        toAddress: input.to,
        category: 'test',
        transport,
        messageId: result.messageId,
        error: result.detail,
        attempts: 1,
        sentAt: result.ok ? new Date() : null,
      });
    }
    await recordAudit(this.deps.db, actor, { action: 'mail.test', resourceType: 'mail_settings', resourceId: KEY, outcome: result.ok ? 'success' : 'failed', organizationId: null, metadata: { to: input.to, draft: !!input.draft } });
    return result;
  }
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

function portOf(url: string | undefined): number | null {
  try {
    const port = url ? new URL(url).port : '';
    return port ? Number(port) : null;
  } catch {
    return null;
  }
}
