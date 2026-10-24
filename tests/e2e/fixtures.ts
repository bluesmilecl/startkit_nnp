import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const root = new URL('../..', import.meta.url).pathname;
export const env: Record<string, string> = existsSync(`${root}.env.e2e`)
  ? Object.fromEntries(
      readFileSync(`${root}.env.e2e`, 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    )
  : {};

export const OWNER = env.OWNER_EMAIL ?? 'owner@e2e.test';
const MAILPIT = process.env.E2E_MAILPIT_URL ?? `http://localhost:${env.MAILPIT_PORT ?? '8025'}`;

export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@e2e.test`;
}

/** Latest OTP e-mailed to `email` (captured by Mailpit), newer than `since`. */
export async function otpFor(email: string, since = 0): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const body = (await res.json()) as { messages: { Subject: string; Created: string }[] };
    const msg = body.messages.find((m) => new Date(m.Created).getTime() >= since - 1000 && /^\d+ es tu código/.test(m.Subject));
    if (msg) return msg.Subject.match(/^(\d+)/)![1]!;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP e-mail for ${email}`);
}

export async function mailsTo(email: string): Promise<{ Subject: string }[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  return ((await res.json()) as { messages: { Subject: string }[] }).messages;
}

/** Direct database access for fixtures only (expire a code, inspect audit). Never used to fake API results. */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const url =
    process.env.E2E_DATABASE_URL ??
    `postgres://${env.POSTGRES_USER ?? 'starter'}:${env.POSTGRES_PASSWORD ?? 'starter'}@localhost:${env.POSTGRES_PORT ?? '55433'}/${env.POSTGRES_DB ?? 'starter'}`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

export async function waitHydrated(page: Page): Promise<void> {
  await page.waitForSelector('html[data-hydrated="true"]');
}

/** Full UI login through the OTP flow. */
export async function login(page: Page, email: string, opts: { navigate?: boolean } = {}): Promise<void> {
  if (opts.navigate !== false) await page.goto('/login');
  await waitHydrated(page);
  const since = Date.now();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/verify/);
  await waitHydrated(page);
  await page.getByTestId('otp-input').fill(await otpFor(email, since));
  await page.waitForURL((url) => !url.pathname.startsWith('/verify'), { timeout: 20_000 });
}

/** Session through the public auth API (faster setup for tests that are not about login). */
export async function apiLogin(request: APIRequestContext, email: string): Promise<void> {
  const since = Date.now();
  const origin = new URL(test.info().project.use.baseURL ?? 'http://localhost:8080').origin;
  const r1 = await request.post('/api/auth/email-otp/send-verification-otp', { data: { email, type: 'sign-in' }, headers: { origin } });
  expect(r1.ok(), await r1.text()).toBeTruthy();
  const r2 = await request.post('/api/auth/sign-in/email-otp', { data: { email, otp: await otpFor(email, since) }, headers: { origin } });
  expect(r2.ok(), await r2.text()).toBeTruthy();
}

/** Owner session shared through storage state, created once per worker. */
export const test = base.extend<{ ownerPage: Page }, { ownerState: string }>({
  ownerState: [
    async ({ browser }, use, workerInfo) => {
      const path = `${root}test-results/.owner-${workerInfo.workerIndex}.json`;
      const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL });
      const page = await context.newPage();
      await login(page, OWNER);
      if (page.url().includes('/onboarding')) {
        await page.request.post('/api/admin/settings/onboarding/complete', { headers: { origin: new URL(page.url()).origin } });
      }
      await context.storageState({ path });
      await context.close();
      await use(path);
    },
    { scope: 'worker' },
  ],
  ownerPage: async ({ browser, ownerState }, use, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, storageState: ownerState });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
