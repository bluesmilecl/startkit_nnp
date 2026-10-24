import { expect, sql, test, uniqueEmail, waitHydrated, apiLogin, mailsTo } from './fixtures.js';

test.describe('users and roles from the panel @critical', () => {
  test('create, view, edit, disable, enable and delete a user', async ({ ownerPage: page }) => {
    const email = uniqueEmail('ana');
    await page.goto('/admin/users');
    await waitHydrated(page);
    await page.getByTestId('user-create-open').click();
    await page.getByTestId('user-create-email').fill(email);
    await page.getByTestId('user-create-name').fill('Ana Prueba');
    await page.getByTestId('role-select').click();
    await page.getByTestId('role-option-viewer').click();
    await page.getByTestId('user-create-submit').click();
    await expect(page.getByText(`Usuario ${email} creado`)).toBeVisible();
    await expect.poll(async () => (await mailsTo(email)).length).toBeGreaterThan(0);

    await page.getByTestId('user-search').fill(email);
    await page.getByRole('row').filter({ hasText: email }).getByTestId('user-link').click();
    await expect(page.getByRole('heading', { name: 'Ana Prueba' })).toBeVisible();
    await waitHydrated(page);
    await page.getByTestId('user-edit-name').fill('Ana Editada');
    await page.getByTestId('user-edit-save').click();
    await expect(page.getByText('Cambios guardados')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ana Editada' })).toBeVisible();

    await page.getByTestId('user-detail-toggle').click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.locator('[data-status="disabled"]').first()).toBeVisible();
    await page.getByTestId('user-detail-toggle').click();
    await expect(page.locator('[data-status="disabled"]')).toHaveCount(0);

    await page.getByTestId('user-detail-delete').click();
    await page.getByTestId('confirm-type').fill(email);
    await page.getByTestId('confirm-accept').click();
    await expect(page).toHaveURL(/\/admin\/users$/);
    const rows = await sql(`select count(*)::int as n from users where email = $1`, [email]);
    expect(rows[0]!.n).toBe(0);
    const audit = await sql<{ action: string }>(`select action from audit_events where action like 'users.%' order by occurred_at desc limit 10`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['users.delete', 'users.disable', 'users.update', 'users.create']));
  });

  test('assign a role and change the permission matrix', async ({ ownerPage: page }) => {
    const email = uniqueEmail('rol');
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const created = await (await page.request.post('/api/admin/users', { data: { email, name: 'Rol Test', roleIds: [], sendInvitation: false }, headers: { origin } })).json();
    await page.goto(`/admin/users/${created.id}`);
    await waitHydrated(page);
    await page.getByTestId('role-select').click();
    await page.getByTestId('role-option-editor').click();
    await page.getByTestId('user-assign-role').click();
    await expect(page.getByTestId('user-roles')).toContainText('Editor');

    await page.goto('/admin/permissions');
    await waitHydrated(page);
    const box = page.getByTestId('matrix-viewer-projects.manage');
    const before = await box.getAttribute('data-state');
    await box.click();
    await page.getByTestId('matrix-save').click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByText('Matriz actualizada')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('matrix-viewer-projects.manage')).not.toHaveAttribute('data-state', before ?? '');
  });

  test('the server rejects fabricated requests from users without permission', async ({ browser, ownerPage }) => {
    const email = uniqueEmail('viewer');
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const roles = await (await ownerPage.request.get('/api/admin/roles')).json();
    const viewerRole = roles.find((r: { key: string }) => r.key === 'viewer');
    await ownerPage.request.post('/api/admin/users', { data: { email, name: 'Solo Lectura', roleIds: [viewerRole.id], sendInvitation: false }, headers: { origin } });

    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    await apiLogin(ctx.request, email);
    expect((await ctx.request.get('/api/admin/users')).status()).toBe(403);
    expect((await ctx.request.post('/api/admin/users', { data: { email: uniqueEmail(), name: 'x' }, headers: { origin } })).status()).toBe(403);
    expect((await ctx.request.put(`/api/admin/roles/${viewerRole.id}/permissions`, { data: { permissions: ['users.delete'] }, headers: { origin } })).status()).toBe(403);
    const page = await ctx.newPage();
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/forbidden/);
    await ctx.close();
    const denied = await sql(`select count(*)::int as n from audit_events where outcome = 'denied' and action = 'admin_users_create'`);
    expect(denied[0]!.n).toBeGreaterThan(0);
  });

  test('requests from a foreign origin are rejected (CSRF)', async ({ ownerPage: page }) => {
    const r = await page.request.post('/api/admin/users', { data: { email: uniqueEmail(), name: 'x' }, headers: { origin: 'https://evil.example' } });
    expect(r.status()).toBe(403);
  });
});
