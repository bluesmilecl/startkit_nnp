import { randomUUID } from 'node:crypto';
import { apiLogin, expect, MAILPIT, OWNER, sql, test, uniqueEmail, waitHydrated } from './fixtures.js';

/** SMTP server as the API sees it: the Mailpit service inside the Docker stack (localhost for `pnpm dev`). */
const SMTP_HOST = process.env.E2E_SMTP_HOST ?? 'mailpit';
const SMTP_PORT = process.env.E2E_SMTP_PORT ?? '1025';

async function waitForMail(to: string, match: RegExp, since: number, seconds = 30): Promise<{ ID: string; Subject: string }> {
  for (let i = 0; i < seconds; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string; Subject: string; Created: string }[] };
    const m = messages.find((x) => new Date(x.Created).getTime() >= since - 1000 && match.test(x.Subject));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No e-mail to ${to} matching ${match}`);
}

test.describe('Correo', () => {
  test('provider: check the connection and send a test with the form values, without saving', async ({ ownerPage: page }) => {
    await page.goto('/admin/mail');
    await waitHydrated(page);
    const sourceBefore = (await page.getByTestId('mail-source').textContent())!.trim();

    await page.getByTestId('mail-provider-smtp').click();
    await page.getByTestId('mail-from').fill('Pruebas E2E <no-reply@e2e.test>');
    await page.getByTestId('mail-smtp-host').fill(SMTP_HOST);
    await page.getByTestId('mail-smtp-port').fill(SMTP_PORT);
    await page.getByTestId('mail-check').click();
    await expect(page.getByTestId('mail-result')).toContainText('Conexión correcta');

    const to = uniqueEmail('mail-prueba');
    const since = Date.now();
    await page.getByTestId('mail-test-open').click();
    await page.getByTestId('mail-test-to').fill(to);
    await page.getByTestId('mail-test-submit').click();
    await expect(page.getByTestId('mail-result')).toContainText('Correo de prueba enviado');
    await waitForMail(to, /^Prueba de correo/, since);

    // Nothing was stored: the source is unchanged after a reload.
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId('mail-source')).toHaveText(sourceBefore);
    const [row] = await sql<{ category: string; status: string }>(`select category, status from mail_deliveries where to_address = $1`, [to]);
    expect(row).toEqual({ category: 'test', status: 'sent' });
  });

  test('template editor: live preview, variables, save and delete a custom template', async ({ ownerPage: page }) => {
    const name = `Aviso ${randomUUID().slice(0, 6)}`;
    await page.goto('/admin/mail/templates');
    await waitHydrated(page);
    await expect(page.getByTestId('template-auth.otp')).toBeVisible();
    await expect(page.getByTestId('template-auth.password_reset')).toBeVisible();
    await expect(page.getByTestId('template-account.confirmation')).toBeVisible();

    await page.getByTestId('template-new').click();
    await page.getByTestId('template-form-name').fill(name);
    await page.getByTestId('template-form-submit').click();
    await page.waitForURL(/\/admin\/mail\/templates\/[0-9a-f-]{36}$/);
    await waitHydrated(page);

    await page.getByTestId('template-subject').fill('Hola ');
    await page.getByTestId('template-var-recipient.name').click();
    await expect(page.getByTestId('template-dirty')).toBeVisible();
    // Sample values fill the preview while typing.
    await expect(page.getByTestId('template-preview-subject')).not.toContainText('{{');
    await expect(page.getByTestId('template-preview-subject')).toContainText('Hola ');
    await page.getByTestId('template-preview-mobile').click();
    await expect(page.getByTestId('template-preview')).toBeVisible();

    await page.getByTestId('template-save').click();
    await expect(page.getByTestId('template-dirty')).toHaveCount(0);
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId('template-subject')).toHaveValue('Hola {{recipient.name}}');

    const [tpl] = await sql<{ key: string }>(`select key from mail_templates where name = $1`, [name]);
    await page.getByTestId('template-delete').click();
    await page.getByTestId('confirm-type').fill(tpl!.key);
    await page.getByTestId('confirm-accept').click();
    await page.waitForURL(/\/admin\/mail\/templates$/);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test('automation: creating a project e-mails the person who did it', async ({ ownerPage: page }) => {
    test.setTimeout(180_000);
    const name = `Aviso de proyecto ${randomUUID().slice(0, 6)}`;
    await page.goto('/admin/mail/automations');
    await waitHydrated(page);
    await page.getByTestId('automation-new').click();
    await page.getByTestId('automation-form-name').fill(name);
    await page.getByTestId('automation-form-trigger').click();
    await page.getByRole('option', { name: 'Proyecto creado' }).click();
    await page.getByTestId('automation-form-recipient').click();
    await page.getByRole('option', { name: 'Quien hizo la acción' }).click();
    await page.getByTestId('automation-form-submit').click();
    await expect(page.getByTestId(`automation-${name}`)).toBeVisible();

    const origin = new URL(page.url()).origin;
    const project = `Proyecto correo ${randomUUID().slice(0, 6)}`;
    const since = Date.now();
    expect((await page.request.post('/api/projects', { data: { name: project }, headers: { origin } })).status()).toBe(201);
    // The worker reads audited events every minute (after a short settle window).
    const mail = await waitForMail(OWNER, /^Proyecto creado/, since, 150);
    const body = (await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()) as { Text: string };
    expect(body.Text).toContain(project);

    await page.goto('/admin/mail/deliveries');
    await waitHydrated(page);
    await expect(page.getByRole('row', { name: new RegExp(OWNER) }).first()).toBeVisible();

    const [a] = await sql<{ id: string }>(`select id from mail_automations where name = $1`, [name]);
    expect((await page.request.delete(`/api/admin/mail/automations/${a!.id}`, { headers: { origin } })).ok()).toBe(true);
  });

  test('roles without mail permissions get 403 and no menu', async ({ ownerPage, browser }) => {
    await ownerPage.goto('/admin');
    const origin = new URL(ownerPage.url()).origin;
    const roles = (await (await ownerPage.request.get('/api/admin/roles')).json()) as { id: string; key: string }[];
    const email = uniqueEmail('mail-viewer');
    await ownerPage.request.post('/api/admin/users', { data: { email, name: 'Lectora Correo', roleIds: [roles.find((r) => r.key === 'viewer')!.id], sendInvitation: false }, headers: { origin } });

    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    await apiLogin(ctx.request, email);
    expect((await ctx.request.get('/api/admin/mail/settings')).status()).toBe(403);
    expect((await ctx.request.get('/api/admin/mail/templates')).status()).toBe(403);
    expect((await ctx.request.put('/api/admin/mail/settings', { data: { provider: { transport: 'smtp', from: 'x@e2e.test', smtpHost: 'evil.test' }, version: 0 }, headers: { origin } })).status()).toBe(403);
    const page = await ctx.newPage();
    await page.goto('/admin');
    await waitHydrated(page);
    await expect(page.getByRole('link', { name: 'Plantillas' })).toHaveCount(0);
    await ctx.close();
  });
});
