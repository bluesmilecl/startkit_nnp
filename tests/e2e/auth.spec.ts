import { expect, login, otpFor, sql, test, uniqueEmail, waitHydrated, OWNER, apiLogin, mailsTo } from './fixtures.js';

test.describe('OTP login @critical', () => {
  test('correct code signs in and lands on the requested page', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await login(page, OWNER, { navigate: false });
    await expect(page).toHaveURL(/\/admin\/users|\/onboarding/);
  });

  test('wrong code is rejected with a clear message', async ({ page }) => {
    const email = OWNER;
    await page.goto(`/login`);
    await waitHydrated(page);
    await page.getByTestId('login-email').fill(email);
    const since = Date.now();
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/verify/);
    await waitHydrated(page);
    const real = await otpFor(email, since);
    const wrong = real === '000000' ? '111111' : '000000';
    await page.getByTestId('otp-input').fill(wrong);
    await expect(page.getByTestId('verify-error')).toContainText('no es válido');
    await expect(page).toHaveURL(/\/verify/);
  });

  test('expired code is rejected', async ({ page }) => {
    const since = Date.now();
    await page.goto('/login');
    await waitHydrated(page);
    await page.getByTestId('login-email').fill(OWNER);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/verify/);
    const code = await otpFor(OWNER, since);
    await sql(`update verifications set expires_at = now() - interval '1 second' where identifier = $1`, [`sign-in-otp-${OWNER}`]);
    await waitHydrated(page);
    await page.getByTestId('otp-input').fill(code);
    await expect(page.getByTestId('verify-error')).toBeVisible();
    await expect(page).toHaveURL(/\/verify/);
  });

  test('resend is limited by the cooldown', async ({ page, request }) => {
    await page.goto('/login');
    await waitHydrated(page);
    await page.getByTestId('login-email').fill(OWNER);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/verify/);
    await waitHydrated(page);
    await expect(page.getByTestId('resend')).toBeDisabled();
    const r = await request.post('/api/auth/email-otp/send-verification-otp', {
      data: { email: OWNER, type: 'sign-in' },
      headers: { origin: new URL(page.url()).origin },
    });
    expect(r.status()).toBe(429);
    expect((await r.json()).code).toBe('OTP_RESEND_COOLDOWN');
  });

  test('unknown e-mails get the same response but no code is sent (invite-only)', async ({ page }) => {
    const stranger = uniqueEmail('stranger');
    await page.goto('/login');
    await waitHydrated(page);
    await page.getByTestId('login-email').fill(stranger);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/verify/);
    await page.waitForTimeout(1500);
    const rows = await sql(`select count(*)::int as n from users where email = $1`, [stranger]);
    expect(rows[0]!.n).toBe(0);
    await expect(otpFor(stranger, Date.now() - 5000)).rejects.toThrow();
  });
});

test.describe('session @critical', () => {
  test('SSR keeps the session on reload, logout ends it', async ({ page }) => {
    await login(page, OWNER);
    if (page.url().includes('/onboarding')) await page.request.post('/api/admin/settings/onboarding/complete', { headers: { origin: new URL(page.url()).origin } });
    await page.goto('/admin');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
    await waitHydrated(page);
    await page.getByTestId('user-menu').click();
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a revoked session is detected and the user is sent to session-expired', async ({ page, browser }) => {
    await login(page, OWNER);
    await page.goto('/admin/profile');
    await waitHydrated(page);
    // Revoke this page's session from a second one. Only that session: the shared owner
    // session used by the other specs must survive.
    const mine = ((await (await page.request.get('/api/me/sessions')).json()) as { id: string; current: boolean }[]).find((s) => s.current)!;
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    await apiLogin(other.request, OWNER);
    const origin = new URL(page.url()).origin;
    const revoked = await other.request.delete(`/api/me/sessions/${mine.id}`, { headers: { origin } });
    expect(revoked.ok(), await revoked.text()).toBeTruthy();
    await other.close();
    await page.getByTestId('profile-name').fill('Propietaria E2E');
    await page.getByTestId('profile-save').click();
    await expect(page).toHaveURL(/\/session-expired|\/login/);
  });
});

test.describe('demo access', () => {
  test('the demo account signs in from the login screen with the fixed code and no e-mail', async ({ page, ownerPage }) => {
    const settings = (await (await page.request.get('/api/public/settings')).json()) as { demoLogin: { email: string; code: string } | null };
    test.skip(!settings.demoLogin, 'DEMO_LOGIN_EMAIL is not set in this stack');
    const { email, code } = settings.demoLogin!;
    // The demo account must have access: the owner creates it once (409 when it already exists).
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const roles = (await (await ownerPage.request.get('/api/admin/roles')).json()) as { id: string; key: string }[];
    const created = await ownerPage.request.post('/api/admin/users', { data: { email, name: 'Cuenta demo', roleIds: [roles.find((r) => r.key === 'admin')!.id], sendInvitation: false }, headers: { origin } });
    expect([201, 409]).toContain(created.status());

    await page.goto('/login');
    await waitHydrated(page);
    await expect(page.getByTestId('demo-login')).toContainText(code);
    await page.getByTestId('demo-login-use').click();
    await page.waitForURL(/\/verify/);
    await waitHydrated(page);
    await page.getByTestId('demo-code-use').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/verify'), { timeout: 20_000 });
    expect(await mailsTo(email)).toHaveLength(0);
  });
});
