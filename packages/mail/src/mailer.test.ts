import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailer, parseAddress, type MailEnv } from './mailer.js';

const base: MailEnv = { MAIL_TRANSPORT: 'smtp', MAIL_FROM: 'Mesa de Ayuda <no-reply@empresa.cl>', NODE_ENV: 'test', SMTP_URL: 'smtp://localhost:1025', MAILGUN_REGION: 'us' };
const message = { to: 'ana@empresa.cl', subject: '123456 es tu código', html: '<p>123456</p>', text: '123456', category: 'otp' };

function mockFetch(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  const fn = vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const call = (fn: ReturnType<typeof mockFetch>) => {
  const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

afterEach(() => vi.unstubAllGlobals());

describe('mail providers (HTTP APIs, requests as documented by each provider)', () => {
  it('parses display names in MAIL_FROM', () => {
    expect(parseAddress('Mesa de Ayuda <no-reply@empresa.cl>')).toEqual({ name: 'Mesa de Ayuda', email: 'no-reply@empresa.cl' });
    expect(parseAddress('"Equipo, TI" <ti@empresa.cl>')).toEqual({ name: 'Equipo, TI', email: 'ti@empresa.cl' });
    expect(parseAddress('ti@empresa.cl')).toEqual({ name: null, email: 'ti@empresa.cl' });
  });

  it('Postmark: server token header and message id', async () => {
    const fn = mockFetch(200, { MessageID: 'pm-1' });
    const r = await createMailer({ ...base, MAIL_TRANSPORT: 'postmark', POSTMARK_SERVER_TOKEN: 'tok' }).send(message);
    const { url, headers, init } = call(fn);
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect(headers['x-postmark-server-token']).toBe('tok');
    expect(JSON.parse(init.body as string)).toMatchObject({ From: base.MAIL_FROM, To: 'ana@empresa.cl', TextBody: '123456', MessageStream: 'outbound' });
    expect(r.id).toBe('pm-1');
  });

  it('SendGrid: bearer key, structured sender and x-message-id', async () => {
    const fn = mockFetch(202, '', { 'x-message-id': 'sg-1' });
    const r = await createMailer({ ...base, MAIL_TRANSPORT: 'sendgrid', SENDGRID_API_KEY: 'SG.key' }).send(message);
    const { url, headers, init } = call(fn);
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(headers.authorization).toBe('Bearer SG.key');
    expect(JSON.parse(init.body as string)).toMatchObject({ from: { email: 'no-reply@empresa.cl', name: 'Mesa de Ayuda' }, personalizations: [{ to: [{ email: 'ana@empresa.cl' }] }] });
    expect(r.id).toBe('sg-1');
  });

  it('Mailgun: basic auth, domain in the path, EU region and form body', async () => {
    const fn = mockFetch(200, { id: '<mg-1@empresa.cl>' });
    await createMailer({ ...base, MAIL_TRANSPORT: 'mailgun', MAILGUN_API_KEY: 'key-1', MAILGUN_DOMAIN: 'mg.empresa.cl', MAILGUN_REGION: 'eu' }).send(message);
    const { url, headers, init } = call(fn);
    expect(url).toBe('https://api.eu.mailgun.net/v3/mg.empresa.cl/messages');
    expect(headers.authorization).toBe(`Basic ${Buffer.from('api:key-1').toString('base64')}`);
    expect((init.body as URLSearchParams).get('to')).toBe('ana@empresa.cl');
  });

  it('Brevo: api-key header and structured sender', async () => {
    const fn = mockFetch(201, { messageId: 'br-1' });
    const r = await createMailer({ ...base, MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'xkeysib' }).send(message);
    const { url, headers, init } = call(fn);
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(headers['api-key']).toBe('xkeysib');
    expect(JSON.parse(init.body as string)).toMatchObject({ sender: { name: 'Mesa de Ayuda', email: 'no-reply@empresa.cl' }, to: [{ email: 'ana@empresa.cl' }] });
    expect(r.id).toBe('br-1');
  });

  it('classifies failures: rejected (4xx) is permanent, outages are retryable, the key never leaks', async () => {
    mockFetch(401, { message: 'invalid token' });
    const denied = await createMailer({ ...base, MAIL_TRANSPORT: 'postmark', POSTMARK_SERVER_TOKEN: 'secret-token' }).send(message).catch((e) => e);
    expect(denied).toMatchObject({ code: 'UPSTREAM_ERROR', retryable: false, details: { upstreamStatus: 401 } });
    expect(denied.message).not.toContain('secret-token');
    mockFetch(503, 'unavailable');
    const down = await createMailer({ ...base, MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'k' }).send(message).catch((e) => e);
    expect(down).toMatchObject({ code: 'UPSTREAM_ERROR', retryable: true });
  });

  it('verify() checks the key without sending', async () => {
    const fn = mockFetch(200, { scopes: ['mail.send'] });
    expect(await createMailer({ ...base, MAIL_TRANSPORT: 'sendgrid', SENDGRID_API_KEY: 'k' }).verify()).toMatchObject({ ok: true });
    expect(call(fn).url).toBe('https://api.sendgrid.com/v3/scopes');
    mockFetch(401, {});
    expect(await createMailer({ ...base, MAIL_TRANSPORT: 'mailgun', MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'mg.empresa.cl' }).verify()).toMatchObject({ ok: false });
  });

  it('Resend verify(): sender domain must be verified; the test sender is explained', async () => {
    mockFetch(200, { data: [{ name: 'empresa.cl', status: 'verified' }] });
    expect(await createMailer({ ...base, MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_1' }).verify()).toMatchObject({ ok: true, detail: 'Dominio empresa.cl: verificado' });
    mockFetch(200, { data: [{ name: 'otro.cl', status: 'verified' }] });
    expect((await createMailer({ ...base, MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_1' }).verify()).ok).toBe(false);
    const fn = mockFetch(200, {});
    const test = await createMailer({ ...base, MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_1', MAIL_FROM: 'App <onboarding@resend.dev>' }).verify();
    expect(test.detail).toMatch(/solo entrega al correo de tu cuenta/);
    expect(fn).not.toHaveBeenCalled();
  });
});
