import type { Env } from '@starter/config';
import { AppError } from '@starter/contracts';
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

export interface MailCheck {
  ok: boolean;
  detail: string | null;
}

export interface Mailer {
  readonly transport: string;
  send(message: MailMessage): Promise<{ id: string | null }>;
  /** Checks the credentials (and, where the provider allows it, the sender domain) without sending. */
  verify(): Promise<MailCheck>;
}

export type MailEnv = Pick<
  Env,
  | 'MAIL_TRANSPORT'
  | 'MAIL_FROM'
  | 'NODE_ENV'
  | 'SMTP_URL'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_USER'
  | 'SMTP_PASSWORD'
  | 'SMTP_SECURE'
  | 'RESEND_API_KEY'
  | 'POSTMARK_SERVER_TOKEN'
  | 'SENDGRID_API_KEY'
  | 'MAILGUN_API_KEY'
  | 'MAILGUN_DOMAIN'
  | 'MAILGUN_REGION'
  | 'BREVO_API_KEY'
>;

const log = createLogger('mail');
const TIMEOUT_MS = 15_000;

/** "Mesa de Ayuda <no-reply@empresa.cl>" → { name, email }. */
export function parseAddress(from: string): { name: string | null; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1]!.trim() || null, email: m[2]!.trim() } : { name: null, email: from.trim() };
}

/** 4xx (bad key, unverified sender, invalid address) will fail again; 429 and 5xx may recover. */
const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

class SmtpMailer implements Mailer {
  readonly transport = 'smtp';
  private readonly transporter: Transporter;
  readonly target: string;
  constructor(
    env: MailEnv,
    private readonly from: string,
  ) {
    if (env.SMTP_HOST) {
      const port = env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587);
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: env.SMTP_SECURE ?? port === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
      });
      this.target = `${env.SMTP_HOST}:${port}`;
    } else {
      this.transporter = nodemailer.createTransport(env.SMTP_URL);
      const u = new URL(env.SMTP_URL);
      this.target = `${u.hostname}:${u.port || 25}`;
    }
  }
  async send(m: MailMessage) {
    try {
      const info = await this.transporter.sendMail({ from: this.from, to: m.to, subject: m.subject, html: m.html, text: m.text });
      log.info({ category: m.category, messageId: info.messageId }, 'mail sent');
      return { id: info.messageId ?? null };
    } catch (err) {
      const e = err as { responseCode?: number; code?: string };
      // 5xx SMTP replies (bad credentials, rejected sender) are permanent; connection problems are not.
      const permanent = (e.responseCode ?? 0) >= 500 || e.code === 'EAUTH';
      throw AppError.upstream(`El servidor de correo ${this.target} no aceptó el envío`, { retryable: !permanent, cause: err });
    }
  }
  async verify() {
    try {
      await this.transporter.verify();
      return { ok: true, detail: `${this.target} acepta la conexión y las credenciales` };
    } catch (err) {
      return { ok: false, detail: `${this.target}: ${sanitizeError(err, 200)}` };
    }
  }
}

class ResendMailer implements Mailer {
  readonly transport = 'resend';
  private readonly client: Resend;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }
  async send(m: MailMessage) {
    const { data, error } = await this.client.emails.send({ from: this.from, to: m.to, subject: m.subject, html: m.html, text: m.text });
    if (error) {
      // Validation errors (bad address, unverified domain) will fail again; quota and outages may not.
      const retryable = !/validation|invalid|missing|restricted|not_found/i.test(error.name ?? '');
      throw AppError.upstream('Resend rechazó el envío', { retryable, cause: new Error(`Resend ${error.name}: ${error.message}`) });
    }
    log.info({ category: m.category, messageId: data?.id }, 'mail sent');
    return { id: data?.id ?? null };
  }
  async verify(): Promise<MailCheck> {
    const sender = parseAddress(this.from).email;
    const domain = sender.split('@')[1] ?? '';
    if (domain === 'resend.dev') return { ok: true, detail: `${sender} es la dirección de prueba de Resend: solo entrega al correo de tu cuenta de Resend; verifica un dominio para enviar a otras personas` };
    const res = await httpCheck('https://api.resend.com/domains', { headers: { authorization: `Bearer ${this.apiKey}` } });
    if (res.status === 401 && /restricted/i.test(res.body)) return { ok: true, detail: 'Clave de solo envío: no permite revisar dominios; prueba con "pnpm starter mail test <correo>"' };
    if (!res.ok) return { ok: false, detail: res.status ? `Resend respondió ${res.status} (¿clave inválida?)` : res.body };
    const domains = ((JSON.parse(res.body) as { data?: { name: string; status: string }[] }).data ?? []);
    const match = domains.find((d) => d.name === domain);
    if (!match) return { ok: false, detail: `El dominio ${domain} de MAIL_FROM no está en tu cuenta de Resend (dominios: ${domains.map((d) => d.name).join(', ') || 'ninguno'})` };
    return { ok: match.status === 'verified', detail: `Dominio ${domain}: ${match.status === 'verified' ? 'verificado' : `estado ${match.status} (agrega los registros DNS en Resend)`}` };
  }
}

interface ApiRequest {
  url: string;
  init: RequestInit;
}

/** HTTP providers share timeouts, error classification and logging. */
abstract class ApiMailer implements Mailer {
  abstract readonly transport: string;
  protected abstract readonly label: string;
  constructor(protected readonly from: string) {}
  protected abstract request(m: MailMessage): ApiRequest;
  protected abstract messageId(res: Response, body: unknown): string | null;
  protected abstract check(): ApiRequest;

  async send(m: MailMessage) {
    const { url, init } = this.request(m);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw AppError.upstream(`No se pudo conectar con ${this.label}`, { cause: err });
    }
    const text = await res.text();
    if (!res.ok) {
      throw AppError.upstream(`${this.label} rechazó el envío (${res.status})`, { retryable: retryableStatus(res.status), details: { upstreamStatus: res.status }, cause: new Error(`${this.label} ${res.status}: ${text.slice(0, 300)}`) });
    }
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const id = this.messageId(res, body);
    log.info({ category: m.category, transport: this.transport, messageId: id }, 'mail sent');
    return { id };
  }

  async verify(): Promise<MailCheck> {
    const { url, init } = this.check();
    const res = await httpCheck(url, init);
    if (res.ok) return { ok: true, detail: `${this.label} acepta la clave` };
    return { ok: false, detail: res.status ? `${this.label} respondió ${res.status} (¿clave o dominio inválidos?)` : res.body };
  }
}

class PostmarkMailer extends ApiMailer {
  readonly transport = 'postmark';
  protected readonly label = 'Postmark';
  constructor(
    private readonly token: string,
    from: string,
  ) {
    super(from);
  }
  private get headers() {
    return { accept: 'application/json', 'content-type': 'application/json', 'x-postmark-server-token': this.token };
  }
  protected request(m: MailMessage) {
    return { url: 'https://api.postmarkapp.com/email', init: { method: 'POST', headers: this.headers, body: JSON.stringify({ From: this.from, To: m.to, Subject: m.subject, HtmlBody: m.html, TextBody: m.text, MessageStream: 'outbound', Tag: m.category }) } };
  }
  protected messageId(_res: Response, body: unknown) {
    return (body as { MessageID?: string } | null)?.MessageID ?? null;
  }
  protected check() {
    return { url: 'https://api.postmarkapp.com/server', init: { headers: this.headers } };
  }
}

class SendGridMailer extends ApiMailer {
  readonly transport = 'sendgrid';
  protected readonly label = 'SendGrid';
  constructor(
    private readonly apiKey: string,
    from: string,
  ) {
    super(from);
  }
  protected request(m: MailMessage) {
    const from = parseAddress(this.from);
    return {
      url: 'https://api.sendgrid.com/v3/mail/send',
      init: {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: m.to }] }],
          from: from.name ? { email: from.email, name: from.name } : { email: from.email },
          subject: m.subject,
          content: [
            { type: 'text/plain', value: m.text },
            { type: 'text/html', value: m.html },
          ],
          categories: [m.category],
        }),
      },
    };
  }
  protected messageId(res: Response) {
    return res.headers.get('x-message-id');
  }
  protected check() {
    return { url: 'https://api.sendgrid.com/v3/scopes', init: { headers: { authorization: `Bearer ${this.apiKey}` } } };
  }
}

class MailgunMailer extends ApiMailer {
  readonly transport = 'mailgun';
  protected readonly label = 'Mailgun';
  private readonly base: string;
  constructor(
    private readonly apiKey: string,
    private readonly domain: string,
    region: 'us' | 'eu',
    from: string,
  ) {
    super(from);
    this.base = region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  }
  private get auth() {
    return `Basic ${Buffer.from(`api:${this.apiKey}`).toString('base64')}`;
  }
  protected request(m: MailMessage) {
    const form = new URLSearchParams({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html, 'o:tag': m.category });
    return { url: `${this.base}/v3/${encodeURIComponent(this.domain)}/messages`, init: { method: 'POST', headers: { authorization: this.auth }, body: form } };
  }
  protected messageId(_res: Response, body: unknown) {
    return (body as { id?: string } | null)?.id ?? null;
  }
  protected check() {
    return { url: `${this.base}/v3/domains/${encodeURIComponent(this.domain)}`, init: { headers: { authorization: this.auth } } };
  }
}

class BrevoMailer extends ApiMailer {
  readonly transport = 'brevo';
  protected readonly label = 'Brevo';
  constructor(
    private readonly apiKey: string,
    from: string,
  ) {
    super(from);
  }
  private get headers() {
    return { accept: 'application/json', 'content-type': 'application/json', 'api-key': this.apiKey };
  }
  protected request(m: MailMessage) {
    const from = parseAddress(this.from);
    return {
      url: 'https://api.brevo.com/v3/smtp/email',
      init: { method: 'POST', headers: this.headers, body: JSON.stringify({ sender: from.name ? { name: from.name, email: from.email } : { email: from.email }, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text, tags: [m.category] }) },
    };
  }
  protected messageId(_res: Response, body: unknown) {
    return (body as { messageId?: string } | null)?.messageId ?? null;
  }
  protected check() {
    return { url: 'https://api.brevo.com/v3/account', init: { headers: this.headers } };
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

async function httpCheck(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, body: `Sin conexión: ${sanitizeError(err, 160)}` };
  }
}

export function createMailer(env: MailEnv): Mailer {
  const from = env.MAIL_FROM;
  switch (env.MAIL_TRANSPORT) {
    case 'resend':
      return new ResendMailer(env.RESEND_API_KEY ?? '', from);
    case 'postmark':
      return new PostmarkMailer(env.POSTMARK_SERVER_TOKEN ?? '', from);
    case 'sendgrid':
      return new SendGridMailer(env.SENDGRID_API_KEY ?? '', from);
    case 'mailgun':
      return new MailgunMailer(env.MAILGUN_API_KEY ?? '', env.MAILGUN_DOMAIN ?? '', env.MAILGUN_REGION ?? 'us', from);
    case 'brevo':
      return new BrevoMailer(env.BREVO_API_KEY ?? '', from);
    case 'log':
      if (env.NODE_ENV === 'production') throw new Error('MAIL_TRANSPORT=log is not allowed in production');
      return new LogMailer();
    default:
      return new SmtpMailer(env, from);
  }
}
