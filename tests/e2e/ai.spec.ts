import { randomUUID } from 'node:crypto';
import { expect, sql, test, waitHydrated } from './fixtures.js';

/**
 * AI administration against the real stack with the deterministic test provider: connection,
 * catalog sync through the worker, explicit verification, tariffs, lab comparison, ledger and
 * budgets. Nothing is mocked: every call goes through the API, the worker and PostgreSQL.
 */
test.describe.serial('AI providers, models, tariffs and costs @critical', () => {
  const alias = `e2e-test-${randomUUID().slice(0, 6)}`;
  let connectionId = '';

  test('creates a test-provider connection, syncs and verifies models', async ({ ownerPage: page }) => {
    await page.goto('/admin/ai/connections');
    await waitHydrated(page);
    await page.getByTestId('connection-new').click();
    await page.getByTestId('connection-provider').click();
    await page.getByRole('option', { name: /Proveedor de prueba/ }).click();
    await page.getByTestId('connection-alias').fill(alias);
    await page.getByTestId('connection-submit').click();
    await expect(page.getByText(`Conexión ${alias} creada`)).toBeVisible();
    const card = page.getByTestId(`connection-${alias}`);
    await expect(card.getByTestId('connection-status')).toHaveAttribute('data-status', 'ok');
    connectionId = (await sql<{ id: string }>(`select id from provider_connections where alias = $1`, [alias]))[0]!.id;

    await card.getByTestId('connection-sync').click();
    await expect(page.getByText('Sincronización de modelos en cola')).toBeVisible();
    await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int as n from model_catalog where connection_id = $1`, [connectionId]))[0]!.n, { timeout: 30_000 }).toBe(4);

    await page.goto(`/admin/ai/models?connectionId=${connectionId}`);
    await waitHydrated(page);
    const row = page.getByRole('row').filter({ hasText: 'test-chat ' }).filter({ hasText: alias }).first();
    await expect(row.getByTestId('model-availability')).toHaveAttribute('data-status', 'unverified');
    await row.getByTestId('model-verify').click();
    await expect(page.getByText('test-chat disponible')).toBeVisible();
    await expect(row.getByTestId('model-availability')).toHaveAttribute('data-status', 'available');
  });

  test('syncs tariffs and shows them in the catalog', async ({ ownerPage: page }) => {
    await page.goto('/admin/ai/prices');
    await waitHydrated(page);
    await page.getByTestId('prices-sync').click();
    await expect(page.getByText('Sincronización de tarifas en cola')).toBeVisible();
    await expect
      .poll(async () => (await sql<{ n: number }>(`select count(*)::int as n from model_prices where provider = 'test' and effective_to is null`))[0]!.n, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(6);
    await page.goto(`/admin/ai/models?connectionId=${connectionId}`);
    await expect(page.getByRole('row').filter({ hasText: 'test-chat-mini' }).first()).toContainText('US$ 0,1 / 1M');
  });

  test('a lab comparison runs in the worker and lands in the ledger with its cost', async ({ ownerPage: page }) => {
    await page.goto('/admin/ai/lab');
    await waitHydrated(page);
    await page.getByRole('tab', { name: /Comparación/ }).click();
    const [model] = await sql<{ id: string }>(`select id from model_catalog where connection_id = $1 and model_id = 'test-chat'`, [connectionId]);
    await page.locator(`[id="cm-${model!.id}"]`).click();
    await page.getByTestId('cmp-prompt-0').fill('Hola desde Playwright');
    await page.getByTestId('cmp-submit').click();
    await expect(page.getByTestId('lab-run-status')).toHaveAttribute('data-status', 'succeeded', { timeout: 30_000 });
    await expect(page.getByTestId('lab-cell-0')).toContainText('Hola desde Playwright');

    const [req] = await sql<{ cost_status: string; cost_usd: string | null; attempts: number }>(
      `select r.cost_status, r.cost_usd, (select count(*)::int from ai_attempts a where a.ai_request_id = r.id) as attempts
         from ai_requests r where r.feature = 'lab' and r.connection_id = $1 order by r.started_at desc limit 1`,
      [connectionId],
    );
    expect(req!.cost_status).toBe('calculated');
    expect(Number(req!.cost_usd)).toBeGreaterThan(0);
    expect(req!.attempts).toBe(1);

    await page.goto('/admin/ai/usage');
    await waitHydrated(page);
    await expect(page.getByTestId('stat-cost')).toContainText(/Costo del período\s*US\$ [0-9,.]*[1-9]/);
    await expect(page.getByRole('row').filter({ hasText: 'Laboratorio' }).first()).toBeVisible();
  });

  test('a hard budget blocks calls before they reach the provider', async ({ ownerPage: page }) => {
    const name = `E2E estricto ${randomUUID().slice(0, 4)}`;
    await page.goto('/admin/ai/budgets');
    await waitHydrated(page);
    await page.getByTestId('budget-new').click();
    await page.getByTestId('budget-name').fill(name);
    await page.getByTestId('budget-limit').fill('0.0000001');
    await page.getByTestId('budget-submit').click();
    await expect(page.getByTestId(`budget-${name}`)).toBeVisible();
    try {
      const before = (await sql<{ n: number }>(`select count(*)::int as n from ai_attempts a join ai_requests r on r.id = a.ai_request_id where r.connection_id = $1`, [connectionId]))[0]!.n;
      await page.goto('/admin/ai/lab');
      await waitHydrated(page);
      await page.getByRole('tab', { name: /Comparación/ }).click();
      const [model] = await sql<{ id: string }>(`select id from model_catalog where connection_id = $1 and model_id = 'test-chat'`, [connectionId]);
      await page.locator(`[id="cm-${model!.id}"]`).click();
      await page.getByTestId('cmp-prompt-0').fill('No debería ejecutarse');
      await page.getByTestId('cmp-submit').click();
      await expect(page.getByTestId('lab-run-status')).toHaveAttribute('data-status', 'succeeded', { timeout: 30_000 });
      await expect(page.getByTestId('lab-cell-0')).toContainText(`Presupuesto «${name}» alcanzado`);
      const after = (await sql<{ n: number }>(`select count(*)::int as n from ai_attempts a join ai_requests r on r.id = a.ai_request_id where r.connection_id = $1`, [connectionId]))[0]!.n;
      expect(after).toBe(before);
    } finally {
      await sql(`delete from budgets where name = $1`, [name]);
    }
  });

  test('stored keys are never shown again', async ({ ownerPage: page }) => {
    const secret = `sk-e2e-${randomUUID().replace(/-/g, '')}`;
    const keyAlias = `e2e-openai-${randomUUID().slice(0, 6)}`;
    await page.goto('/admin/ai/connections');
    await waitHydrated(page);
    await page.getByTestId('connection-new').click();
    await page.getByTestId('connection-alias').fill(keyAlias);
    await page.getByTestId('connection-key').fill(secret);
    await page.getByTestId('connection-submit').click();
    const card = page.getByTestId(`connection-${keyAlias}`);
    await expect(card.getByTestId('connection-hint')).toContainText(secret.slice(-4));
    await page.reload();
    await waitHydrated(page);
    expect(await page.content()).not.toContain(secret);
    const [row] = await sql<{ credential_ciphertext: string }>(`select credential_ciphertext from provider_connections where alias = $1`, [keyAlias]);
    expect(row!.credential_ciphertext).toMatch(/^enc:v1:/);
    expect(row!.credential_ciphertext).not.toContain(secret);
    await sql(`delete from provider_connections where alias = $1`, [keyAlias]);
  });
});
