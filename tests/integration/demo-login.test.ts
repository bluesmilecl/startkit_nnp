import { createAuth } from '@starter/auth';
import { featureFlags, type Env } from '@starter/config';
import type { Mailer, MailMessage } from '@starter/mail';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeUser, testContext } from './helpers.js';

let ctx: Awaited<ReturnType<typeof testContext>>;
const sent: MailMessage[] = [];
const mailer: Mailer = { transport: 'log', send: async (m) => (sent.push(m), { id: null }), verify: async () => ({ ok: true }) };

beforeAll(async () => {
  ctx = await testContext();
});

function auth(env: Partial<Env>) {
  const full = { ...ctx.env, OTP_RESEND_SECONDS: 60, ...env } as Env;
  return createAuth({ db: ctx.handle.db, env: full, mailer, features: featureFlags(full) });
}

const failure = (p: Promise<unknown>) => p.then(() => 'OK', (err: { body?: { code?: string } }) => err.body?.code ?? 'ERROR');

describe('demo access (DEMO_LOGIN_EMAIL)', () => {
  it('signs the demo account in with the fixed code, without e-mail and without resend cooldown', async () => {
    const demo = await makeUser(ctx.handle, { email: 'demo-acceso@example.test', roles: ['admin'] });
    const a = auth({ DEMO_LOGIN_EMAIL: demo.email, DEMO_LOGIN_CODE: '111111' });
    const before = sent.length;
    await a.api.sendVerificationOTP({ body: { email: demo.email, type: 'sign-in' } });
    expect(sent.length).toBe(before);
    expect((await a.api.signInEmailOTP({ body: { email: 'Demo-Acceso@example.test', otp: '111111' } })).user.email).toBe(demo.email);

    // Again right away: no OTP_RESEND_COOLDOWN for the demo account.
    await a.api.sendVerificationOTP({ body: { email: demo.email, type: 'sign-in' } });
    expect((await a.api.signInEmailOTP({ body: { email: demo.email, otp: '111111' } })).user.id).toBe(demo.id);
  });

  it('other accounts keep random codes sent by e-mail', async () => {
    const other = await makeUser(ctx.handle, { roles: ['viewer'] });
    const a = auth({ DEMO_LOGIN_EMAIL: 'demo-acceso@example.test', DEMO_LOGIN_CODE: '111111' });
    await a.api.sendVerificationOTP({ body: { email: other.email, type: 'sign-in' } });
    const mail = sent.at(-1)!;
    expect(mail.to).toBe(other.email);
    const code = /^(\d+)/.exec(mail.subject)![1]!;
    if (code !== '111111') expect(await failure(a.api.signInEmailOTP({ body: { email: other.email, otp: '111111' } }))).toBe('INVALID_OTP');
  });

  it('is ignored in production even if the environment was built by hand', async () => {
    const demo = await makeUser(ctx.handle, { roles: ['admin'] });
    const a = auth({ NODE_ENV: 'production', DEMO_LOGIN_EMAIL: demo.email, DEMO_LOGIN_CODE: '111111' });
    const before = sent.length;
    await a.api.sendVerificationOTP({ body: { email: demo.email, type: 'sign-in' } });
    expect(sent.length).toBe(before + 1);
    const code = /^(\d+)/.exec(sent.at(-1)!.subject)![1]!;
    if (code !== '111111') expect(await failure(a.api.signInEmailOTP({ body: { email: demo.email, otp: '111111' } }))).toBe('INVALID_OTP');
  });
});
