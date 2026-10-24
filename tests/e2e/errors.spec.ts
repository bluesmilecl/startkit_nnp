import { randomUUID } from 'node:crypto';
import { expect, test, waitHydrated } from './fixtures.js';

/**
 * Error standard (docs/errors.md): one response shape with Spanish messages and a request id,
 * database races mapped to field conflicts instead of 500s, the Spanish error page for unknown
 * routes and records, and LoadError/notify.error in the panel.
 */
test.describe('Error standard', () => {
  test('API errors share one shape: code, Spanish message, request id, no-store', async ({ ownerPage: page }) => {
    await page.goto('/admin');
    const origin = new URL(page.url()).origin;

    const malformed = await page.request.post('/api/projects', { data: '{bad', headers: { origin, 'content-type': 'application/json' } });
    expect(malformed.status()).toBe(400);
    const malformedBody = await malformed.json();
    expect(malformedBody.error.code).toBe('BAD_REQUEST');
    expect(malformedBody.error.requestId).toBe(malformed.headers()['x-request-id']);
    expect(malformed.headers()['cache-control']).toBe('no-store');

    const route = await page.request.get('/api/no-existe');
    expect(route.status()).toBe(404);
    expect((await route.json()).error).toMatchObject({ code: 'NOT_FOUND', message: 'Lo que buscas no existe o ya no está disponible.' });

    // A malformed id cannot identify anything: 404, like an unknown one.
    expect((await page.request.get('/api/projects/no-es-un-uuid')).status()).toBe(404);
    const unknown = await page.request.get(`/api/projects/${randomUUID()}`);
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).error.message).toBe('Proyecto no encontrado');

    const invalid = await page.request.post('/api/projects', { data: { name: 'x' }, headers: { origin } });
    expect(invalid.status()).toBe(422);
    const issue = (await invalid.json()).error;
    expect(issue.code).toBe('VALIDATION_FAILED');
    expect(issue.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'name', message: expect.any(String) })]));

    // A caller-provided correlation id is kept end to end.
    const traced = await page.request.get('/api/no-existe', { headers: { 'x-request-id': 'e2e-trace-0001' } });
    expect(traced.headers()['x-request-id']).toBe('e2e-trace-0001');
    expect((await traced.json()).error.requestId).toBe('e2e-trace-0001');
  });

  test('concurrent duplicate creates: one wins, the rest get a field conflict (never a 500)', async ({ ownerPage: page }) => {
    await page.goto('/admin');
    const origin = new URL(page.url()).origin;
    const name = `Carrera ${randomUUID().slice(0, 6)}`;
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) => page.request.post('/api/projects', { data: { name: i % 2 ? name.toUpperCase() : name }, headers: { origin } })),
    );
    const statuses = responses.map((r) => r.status()).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    const conflict = await responses.find((r) => r.status() === 409)!.json();
    expect(conflict.error).toMatchObject({ code: 'CONFLICT', details: [{ path: 'name', message: 'Ya existe un proyecto con ese nombre' }] });
  });

  test('unknown pages and records render the Spanish error page with status and request id', async ({ ownerPage: page }) => {
    const missingPage = await page.goto('/admin/no-existe');
    expect(missingPage?.status()).toBe(404);
    await waitHydrated(page);
    await expect(page.getByTestId('error-title')).toHaveText('Página no encontrada');

    const missingRecord = await page.goto(`/admin/users/${randomUUID()}`);
    expect(missingRecord?.status()).toBe(404);
    await waitHydrated(page);
    await expect(page.getByTestId('error-message')).toHaveText('Usuario no encontrado');
    await expect(page.getByTestId('error-request-id')).not.toBeEmpty();
    await page.getByTestId('error-home').click();
    await expect(page).toHaveURL(/\/admin$/);

    // Client-side navigation to a missing record also replaces the page.
    await waitHydrated(page);
    await page.evaluate((path) => {
      type Root = { __vue_app__: { config: { globalProperties: { $router: { push(to: string): Promise<unknown> } } } } };
      return (document.querySelector('#__nuxt') as unknown as Root).__vue_app__.config.globalProperties.$router.push(path);
    }, `/admin/roles/${randomUUID()}`);
    await expect(page.getByTestId('error-page')).toHaveAttribute('data-status', '404');
    await expect(page.getByTestId('error-message')).toHaveText('Rol no encontrado');
  });

  test('a failed load shows LoadError with the request id and recovers with «Reintentar»', async ({ ownerPage: page }) => {
    await page.goto('/admin/projects');
    await waitHydrated(page);
    let failNext = true;
    await page.route(/\/api\/projects\?/, async (route) => {
      if (!failNext) return route.continue();
      failNext = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'x-request-id': 'req-e2e-503', 'retry-after': '5' },
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'La base de datos no está disponible en este momento; intenta de nuevo en unos segundos.', details: { retryAfterSeconds: 5 }, requestId: 'req-e2e-503' } }),
      });
    });
    await page.getByTestId('project-search').fill('sin-resultados');
    const alert = page.getByTestId('project-load-error');
    await expect(alert).toContainText('Servicio no disponible');
    await expect(page.getByTestId('project-load-error-request-id')).toHaveText('req-e2e-503');
    await page.getByTestId('project-load-error-retry').click();
    await expect(alert).toHaveCount(0);
  });

  test('a network failure while saving shows a Spanish message, never browser text', async ({ ownerPage: page }) => {
    await page.goto('/admin/projects');
    await waitHydrated(page);
    await page.route(/\/api\/projects$/, (route) => (route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue()));
    await page.getByTestId('project-new').click();
    await page.getByTestId('project-form-name').fill(`Sin red ${randomUUID().slice(0, 6)}`);
    await page.getByTestId('project-form-submit').click();
    await expect(page.getByTestId('project-form-error')).toContainText('No pudimos conectar con el servidor');
  });

  test('catalog examples: LoadError retry, non-retryable errors and toast with «Reintentar»', async ({ ownerPage: page }) => {
    await page.goto('/admin/components?tab=feedback');
    await waitHydrated(page);
    await expect(page.getByTestId('demo-load-error')).toContainText('req_5b81d0');
    await expect(page.getByTestId('demo-forbidden')).toContainText('Sin permiso');
    await expect(page.getByTestId('demo-forbidden-retry')).toHaveCount(0);
    await page.getByTestId('demo-load-error-retry').click();
    await expect(page.getByTestId('demo-load-ok')).toBeVisible();

    await page.getByTestId('toast-retry').click();
    await expect(page.getByText('Intenta de nuevo en 5 s. · Código de solicitud: req_5b81d0')).toBeVisible();
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await expect(page.getByText('Reintento exitoso')).toBeVisible();
  });
});
