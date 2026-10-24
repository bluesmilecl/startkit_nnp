import type { Env } from '@starter/config';
import { createLogger, sanitizeError } from '@starter/observability';
import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Category used in logs and metrics (never the content). */
  category: string;
}

export interface Mailer {
  readonly transport: string;
  send(message: MailMessage): Promise<{ id: string | null }>;
  verify(): Promise<{ ok: boolean; detail: string | null }>;
}

const log = createLogger('mail');

class SmtpMailer implements Mailer {
  readonly transport = 'smtp';
  private readonly transporter: Transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(url);
  }
  async send(m: MailMessage) {
    const info = await this.transporter.sendMail({ from: this.from, to: m.to, subject: m.subject, html: m.html, text: m.text });
    log.info({ category: m.category, messageId: info.messageId }, 'mail sent');
    return { id: info.messageId ?? null };
  }
  async verify() {
    try {
      await this.transporter.verify();
      return { ok: true, detail: null };
    } catch (err) {
      return { ok: false, detail: sanitizeError(err, 200) };
    }
  }
}

class ResendMailer implements Mailer {
  readonly transport = 'resend';
  private readonly client: Resend;
  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }
  async send(m: MailMessage) {
    const { data, error } = await this.client.emails.send({ from: this.from, to: m.to, subject: m.subject, html: m.html, text: m.text });
    if (error) throw new Error(`Resend error: ${error.message}`);
    log.info({ category: m.category, messageId: data?.id }, 'mail sent');
    return { id: data?.id ?? null };
  }
  async verify() {
    return { ok: true, detail: 'Resend API key configured (not verified without sending)' };
  }
}

/** Development-only transport: writes the message to the log. Rejected in production. */
class LogMailer implements Mailer {
  readonly transport = 'log';
  readonly outbox: MailMessage[] = [];
  async send(m: MailMessage) {
    this.outbox.push(m);
    log.info({ category: m.category, to: m.to, subject: m.subject, preview: m.text.slice(0, 400) }, 'mail (log transport)');
    return { id: null };
  }
  async verify() {
    return { ok: true, detail: 'log transport (development only)' };
  }
}

export function createMailer(env: Pick<Env, 'MAIL_TRANSPORT' | 'MAIL_FROM' | 'SMTP_URL' | 'RESEND_API_KEY' | 'NODE_ENV'>): Mailer {
  switch (env.MAIL_TRANSPORT) {
    case 'resend':
      return new ResendMailer(env.RESEND_API_KEY ?? '', env.MAIL_FROM);
    case 'log':
      if (env.NODE_ENV === 'production') throw new Error('MAIL_TRANSPORT=log is not allowed in production');
      return new LogMailer();
    default:
      return new SmtpMailer(env.SMTP_URL, env.MAIL_FROM);
  }
}
