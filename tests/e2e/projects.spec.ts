import { randomUUID } from 'node:crypto';
import { apiLogin, expect, sql, test, uniqueEmail, waitHydrated } from './fixtures.js';

/** Reference module: the template `starter generate module` copies. */
test.describe('Proyectos', () => {
  test('create, search, edit, archive, restore and delete with confirmation', async ({ ownerPage: page }) => {
    const name = `Proyecto ${randomUUID().slice(0, 6)}`;
    await page.goto('/admin/projects');
    await waitHydrated(page);

    await page.getByTestId('project-new').click();
    await page.getByTestId('project-form-name').fill('x');
    await page.getByTestId('project-form-submit').click();
    await expect(page.getByText('Mínimo 2 caracteres')).toBeVisible();
    await page.getByTestId('project-form-name').fill(name);
    await page.getByTestId('project-form-description').fill('Migración del sistema de inventario');
    await page.getByTestId('project-form-submit').click();
    await expect(page.getByText('Proyecto creado')).toBeVisible();

    await page.getByTestId('project-search').fill(name);
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page).toHaveURL(new RegExp(`search=${encodeURIComponent(name).replace(/%20/g, '(\\+|%20)')}`));

    // A duplicate name is rejected by the server and shown on the field.
    await page.getByTestId('project-new').click();
    await page.getByTestId('project-form-name').fill(name.toUpperCase());
    await page.getByTestId('project-form-submit').click();
    await expect(page.getByTestId('project-form-error')).toContainText('Ya existe un proyecto con ese nombre');
    await page.keyboard.press('Escape');

    await row.getByTestId('project-actions').click();
    await page.getByTestId('project-edit').click();
    await page.getByTestId('project-form-description').fill('Inventario y bodegas');
    await page.getByTestId('project-form-submit').click();
    await expect(page.getByText('Proyecto actualizado')).toBeVisible();
    await expect(row).toContainText('Inventario y bodegas');

    await row.getByTestId('project-actions').click();
    await page.getByTestId('project-toggle-archive').click();
    await expect(row).toContainText('Archivado');
    await row.getByTestId('project-actions').click();
    await page.getByTestId('project-toggle-archive').click();
    await expect(row).toContainText('Activo');

    await row.getByTestId('project-actions').click();
    await page.getByTestId('project-delete').click();
    await expect(page.getByTestId('confirm-accept')).toBeDisabled();
    await page.getByTestId('confirm-type').fill(name);
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByText('Proyecto eliminado')).toBeVisible();
    await expect(row).toHaveCount(0);

    const audit = await sql<{ action: string }>(`select action from audit_events where resource_type = 'project' and (before->>'name' = $1 or after->>'name' = $1) order by occurred_at`, [name]);
    expect(audit.map((a) => a.action)).toEqual(['projects.create', 'projects.update', 'projects.archive', 'projects.restore', 'projects.delete']);
  });

  test('the list can be shown as cards that keep the row actions', async ({ ownerPage: page }) => {
    await page.goto('/admin');
    const origin = new URL(page.url()).origin;
    const name = `Tarjeta ${randomUUID().slice(0, 6)}`;
    expect((await page.request.post('/api/projects', { data: { name }, headers: { origin } })).status()).toBe(201);
    await page.goto(`/admin/projects?search=${encodeURIComponent(name)}`);
    await waitHydrated(page);
    await page.getByTestId('project-view-cards').click();
    const card = page.locator('[data-testid^="card-"]').filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await card.getByTestId('project-actions').click();
    await page.getByTestId('project-edit').click();
    await expect(page.getByTestId('project-form-name')).toHaveValue(name);
    await page.keyboard.press('Escape');
    await page.getByTestId('project-view-table').click();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
  });

  test('concurrent edits: the second save is rejected with 412 and nothing is overwritten', async ({ ownerPage: page }) => {
    await page.goto('/admin');
    const origin = new URL(page.url()).origin;
    const created = await (await page.request.post('/api/projects', { data: { name: `Concurrencia ${randomUUID().slice(0, 6)}` }, headers: { origin } })).json();
    const first = await page.request.patch(`/api/projects/${created.id}`, { data: { description: 'primera', version: created.version }, headers: { origin } });
    expect(first.status()).toBe(200);
    const second = await page.request.patch(`/api/projects/${created.id}`, { data: { description: 'segunda', version: created.version }, headers: { origin } });
    expect(second.status()).toBe(412);
    expect((await second.json()).error.code).toBe('PRECONDITION_FAILED');
    expect((await (await page.request.get(`/api/projects/${created.id}`)).json()).description).toBe('primera');
  });

  test('read-only roles can list but not change records; the panel hides the actions', async ({ ownerPage, browser }) => {
    await ownerPage.goto('/admin');
    const origin = new URL(ownerPage.url()).origin;
    // A dedicated role keeps this independent from specs that edit the default matrix.
    const key = `pj-lector-${randomUUID().slice(0, 6)}`;
    const role = await (await ownerPage.request.post('/api/admin/roles', { data: { key, name: `Lector proyectos ${key}`, rank: 10, permissions: ['projects.read'] }, headers: { origin } })).json();
    const email = uniqueEmail('pj-viewer');
    await ownerPage.request.post('/api/admin/users', { data: { email, name: 'Lector Proyectos', roleIds: [role.id], sendInvitation: false }, headers: { origin } });

    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    await apiLogin(ctx.request, email);
    expect((await ctx.request.get('/api/projects')).status()).toBe(200);
    expect((await ctx.request.post('/api/projects', { data: { name: 'No permitido' }, headers: { origin } })).status()).toBe(403);
    const page = await ctx.newPage();
    await page.goto('/admin/projects');
    await waitHydrated(page);
    await expect(page.getByRole('heading', { name: 'Proyectos' })).toBeVisible();
    await expect(page.getByTestId('project-new')).toHaveCount(0);
    await ctx.close();
  });
});
