import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { apiLogin, env, expect, sql, test, uniqueEmail, waitHydrated } from './fixtures.js';

/**
 * Knowledge (RAG) through the panel against the real stack: internal pgvector store, an
 * external PostgreSQL store, the external retrieval API test double (which also serves a small
 * static site for URL/sitemap ingestion), durable ingestion jobs in the worker, ACLs, the
 * search lab, evaluations, the floating chat with citations and analytics. Only the AI
 * provider is the deterministic test adapter.
 *
 * Addresses are as seen from the API container; override them for a non-Docker stack:
 *   E2E_RETRIEVAL_URL (http://retrieval-test:3005) · E2E_RETRIEVAL_TOKEN · E2E_RAG_PG_URL
 */
const RETRIEVAL_URL = process.env.E2E_RETRIEVAL_URL ?? 'http://retrieval-test:3005';
const RETRIEVAL_TOKEN = process.env.E2E_RETRIEVAL_TOKEN ?? env.RETRIEVAL_TEST_TOKEN ?? '';
const RAG_PG_URL = process.env.E2E_RAG_PG_URL ?? (env.RAG_POSTGRES_PASSWORD ? `postgres://rag:${env.RAG_POSTGRES_PASSWORD}@rag-postgres:5432/rag` : '');
const run = randomUUID().slice(0, 6);
const names = { internal: `Interna ${run}`, postgres: `PG externo ${run}`, api: `API soporte ${run}`, profile: `E2E 64 ${run}`, collection: `Manual E2E ${run}` };
const state: { collectionId?: string } = {};

test.describe.configure({ mode: 'serial' });

const origin = (page: Page) => new URL(page.url() === 'about:blank' ? (test.info().project.use.baseURL ?? 'http://localhost:8080') : page.url()).origin;

async function api<T>(request: APIRequestContext, method: 'get' | 'post' | 'put', path: string, data: unknown, o: string): Promise<T> {
  const res = await request[method](`/api${path}`, { data, headers: { origin: o } });
  expect(res.ok(), `${method.toUpperCase()} ${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Test AI connection with its catalog and tariffs (chat + embeddings). */
async function ensureAiModels(page: Page): Promise<{ chat: string }> {
  const o = origin(page);
  let [conn] = await sql<{ id: string }>(`select id from provider_connections where provider = 'test' and alias = 'e2e-chat'`);
  if (!conn) conn = await api<{ id: string }>(page.request, 'post', '/ai/connections', { provider: 'test', alias: 'e2e-chat' }, o);
  await api(page.request, 'post', '/ai/models/sync', { connectionId: conn.id }, o);
  await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int as n from model_catalog where connection_id = $1`, [conn!.id]))[0]!.n, { timeout: 30_000 }).toBe(4);
  await api(page.request, 'post', '/ai/prices/sync', {}, o);
  await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int as n from model_prices where provider = 'test' and effective_to is null`))[0]!.n, { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
  const [chat] = await sql<{ id: string }>(`select id from model_catalog where connection_id = $1 and model_id = 'test-chat'`, [conn.id]);
  await api(page.request, 'post', `/ai/models/${chat!.id}/verify`, {}, o);
  return { chat: chat!.id };
}

async function createConnection(page: Page, name: string, kind: 'internal' | 'postgres' | 'api', fill?: (p: Page) => Promise<void>) {
  await page.getByTestId('rag-connection-new').click();
  await page.getByTestId('rag-connection-name').fill(name);
  if (kind !== 'internal') {
    await page.locator('#rc-kind').click();
    await page.getByRole('option', { name: kind === 'api' ? 'API de recuperación externa' : 'PostgreSQL externo' }).click();
  }
  await fill?.(page);
  await page.getByTestId('rag-connection-submit').click();
  const card = page.getByTestId(`rag-connection-${name}`);
  // Creation runs a diagnosis; activation (extension, schema, grants or contract check) is only
  // offered while the store is not ready yet.
  await expect(card.getByTestId('rag-diagnostic')).toBeVisible({ timeout: 30_000 });
  if ((await card.getByTestId('rag-connection-status').textContent())?.trim() !== 'Listo') await card.getByTestId('rag-activate').click();
  await expect(card.getByTestId('rag-connection-status')).toHaveText('Listo', { timeout: 30_000 });
  return card;
}

async function select(page: Page, trigger: string, option: string | RegExp) {
  await page.getByTestId(trigger).click();
  await page.getByRole('option', { name: option }).click();
}

async function waitIndexed(page: Page, title: string) {
  await expect(page.getByTestId(`doc-${title}`).getByTestId('doc-status')).toHaveText('Indexado', { timeout: 45_000 });
}

test('connections: internal, external PostgreSQL and retrieval API are diagnosed and activated', async ({ ownerPage: page }) => {
  await page.goto('/admin/knowledge/connections');
  await waitHydrated(page);

  const internal = await createConnection(page, names.internal, 'internal');
  await expect(internal.getByTestId('rag-diagnostic')).toContainText('Extensión pgvector');
  await expect(internal.getByTestId('rag-diagnostic')).toContainText('Privilegios de la aplicación');

  const external = await createConnection(page, names.api, 'api', async (p) => {
    await p.locator('#rc-base').fill(RETRIEVAL_URL);
    await p.locator('#rc-token').fill(RETRIEVAL_TOKEN);
  });
  await expect(external.getByTestId('rag-diagnostic')).toContainText('Capacidades declaradas');
  await expect(external.getByTestId('rag-diagnostic')).toContainText('El servicio filtra por persona');
  // The token is never shown back, only a hint.
  if (RETRIEVAL_TOKEN) await expect(external).not.toContainText(RETRIEVAL_TOKEN);
});

test('connections: an external PostgreSQL store is prepared by the starter', async ({ ownerPage: page }) => {
  test.skip(!RAG_PG_URL, 'External PostgreSQL (rag-db profile) not configured');
  await page.goto('/admin/knowledge/connections');
  await waitHydrated(page);
  const pgCard = await createConnection(page, names.postgres, 'postgres', async (p) => {
    await p.locator('#rc-schema').fill('conocimiento');
    await p.locator('#rc-url').fill(RAG_PG_URL);
  });
  await expect(pgCard.getByTestId('rag-diagnostic')).toContainText('Esquema conocimiento');
  // Only a hint (user@host/db) is shown; the password never comes back.
  const password = new URL(RAG_PG_URL).password;
  if (password) await expect(pgCard).not.toContainText(`:${password}@`);
});

test('embedding profile and collection are created from the panel', async ({ ownerPage: page }) => {
  await page.goto('/admin');
  await ensureAiModels(page);
  await page.goto('/admin/knowledge/connections');
  await waitHydrated(page);
  await page.getByTestId('rag-profile-new').click();
  await page.getByTestId('rag-profile-name').fill(names.profile);
  await page.getByTestId('rag-profile-key').fill(`e2e-64-${run}`);
  await page.locator('#rp-model').click();
  await page.getByRole('option', { name: /test-embedding-64/ }).first().click();
  await page.getByTestId('rag-profile-submit').click();
  await expect(page.getByRole('row', { name: new RegExp(names.profile) })).toContainText('64');

  await page.goto('/admin/knowledge/collections');
  await waitHydrated(page);
  await page.getByTestId('collection-new').click();
  await page.getByTestId('collection-name').fill(names.collection);
  await select(page, 'collection-connection', new RegExp(names.internal));
  await select(page, 'collection-profile', new RegExp(names.profile));
  await page.getByTestId('collection-submit').click();
  await page.waitForURL(/\/admin\/knowledge\/collections\/[0-9a-f-]{36}$/);
  state.collectionId = page.url().split('/').pop()!;
  await waitHydrated(page);
  await expect(page.getByRole('heading', { name: names.collection })).toBeVisible();
});

test('ingestion: upload, text and sitemap sources run as durable jobs; fragments are viewable', async ({ ownerPage: page }) => {
  test.setTimeout(150_000);
  await page.goto(`/admin/knowledge/collections/${state.collectionId}`);
  await waitHydrated(page);

  await page
    .getByTestId('rag-upload')
    .locator('input[type=file]')
    .setInputFiles({ name: 'vacaciones.md', mimeType: 'text/markdown', buffer: Buffer.from('# Vacaciones\n\nCada persona tiene quince días hábiles de vacaciones al año.\n\n## Solicitud\n\nSe piden con dos semanas de anticipación en el portal interno.') });
  await expect(page.getByText('«vacaciones.md» en cola para indexar')).toBeVisible();
  await waitIndexed(page, 'vacaciones');

  // Document-level ACL: an upload restricted to administrators.
  await page.getByText('Restringir los archivos subidos a ciertos roles').click();
  await page.locator('#acl-admin').click();
  await page.locator('#acl-owner').click();
  await page
    .getByTestId('rag-upload')
    .locator('input[type=file]')
    .setInputFiles({ name: 'remuneraciones.md', mimeType: 'text/markdown', buffer: Buffer.from('# Remuneraciones\n\nLas bandas de remuneraciones de vacaciones se revisan cada marzo.') });
  await waitIndexed(page, 'remuneraciones');
  await expect(page.getByTestId('doc-remuneraciones')).toContainText('solo admin, owner');

  await page.getByRole('tab', { name: 'Fuentes' }).click();
  await page.getByTestId('source-new').click();
  await select(page, 'source-kind', 'Texto');
  await page.getByTestId('source-title').fill('Beneficios');
  await page.getByTestId('source-text').fill('El bono de escolaridad se paga en marzo a quienes tengan cargas acreditadas.');
  await page.getByTestId('source-submit').click();
  await expect(page.getByText('Fuente agregada; la sincronización está en cola')).toBeVisible();

  await page.getByTestId('source-new').click();
  await select(page, 'source-kind', 'Sitio completo (sitemap.xml)');
  await page.locator('#src-url').fill(`${RETRIEVAL_URL}/site/sitemap.xml`);
  await page.locator('#src-exc').fill('privado');
  await page.locator('#src-name').fill('Sitio de ayuda');
  await page.getByTestId('source-submit').click();
  await expect(page.getByRole('row', { name: /Sitio de ayuda/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Documentos' }).click();
  await waitIndexed(page, 'Beneficios');
  await waitIndexed(page, 'Guía de despacho');
  await waitIndexed(page, 'Preguntas frecuentes');
  await expect(page.getByTestId('doc-Notas internas')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Trabajos' }).click();
  await expect(page.getByTestId('job-ingest-source').first()).toContainText('Completado');
  await expect(page.getByTestId('job-ingest-document').first()).toContainText('Completado');

  await page.getByRole('tab', { name: 'Documentos' }).click();
  await page.getByTestId('doc-Guía de despacho').getByRole('button', { name: 'Guía de despacho', exact: true }).click();
  const sheet = page.getByTestId('doc-chunks');
  await expect(sheet).toContainText('mismo día hábil');
  await expect(sheet).toContainText('Guía de despacho › Regiones');
  await expect(sheet).not.toContainText('alert(1)');
  await page.keyboard.press('Escape');

  // Embedding cost lands on the jobs and in the AI ledger.
  const [cost] = await sql<{ n: number; usd: string }>(`select count(*)::int as n, coalesce(sum(cost_usd), 0)::text as usd from rag_jobs where collection_id = $1 and kind = 'ingest-document' and status = 'succeeded'`, [state.collectionId]);
  expect(cost!.n).toBe(5);
  expect(Number(cost!.usd)).toBeGreaterThan(0);
});

test('document ACL: a viewer cannot list or open restricted documents', async ({ ownerPage, browser }) => {
  await ownerPage.goto('/admin');
  const o = origin(ownerPage);
  const roles = await (await ownerPage.request.get('/api/admin/roles')).json();
  const viewerRole = roles.find((r: { key: string }) => r.key === 'viewer');
  const email = uniqueEmail('rag-viewer');
  await api(ownerPage.request, 'post', '/admin/users', { email, name: 'Lectora RAG', roleIds: [viewerRole.id], sendInvitation: false }, o);
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  await apiLogin(ctx.request, email);
  const docs = await (await ctx.request.get(`/api/rag/documents?collectionId=${state.collectionId}&pageSize=50`)).json();
  const titles = docs.items.map((d: { title: string }) => d.title);
  expect(titles).toContain('vacaciones');
  expect(titles).not.toContain('remuneraciones');
  const [secret] = await sql<{ id: string }>(`select id from rag.documents where collection_id = $1 and title = 'remuneraciones'`, [state.collectionId]);
  expect((await ctx.request.get(`/api/rag/collections/${state.collectionId}/documents/${secret!.id}`)).status()).toBe(404);
  // Viewers cannot use the lab nor manage sources.
  expect((await ctx.request.post('/api/rag/search', { data: { query: 'x', collectionIds: [state.collectionId] }, headers: { origin: o } })).status()).toBe(403);
  expect((await ctx.request.post(`/api/rag/collections/${state.collectionId}/sources`, { data: { kind: 'text', name: 'x', title: 'x', text: 'x', acl: { roles: [], users: [] } }, headers: { origin: o } })).status()).toBe(403);
  await ctx.close();
});

test('search lab compares methods and an evaluation set measures recall', async ({ ownerPage: page }) => {
  await page.goto('/admin/knowledge/search');
  await waitHydrated(page);
  await page.getByTestId('lab-query').fill('¿En cuántos días llega el despacho a regiones?');
  await page.getByLabel(names.collection).click();
  await page.getByTestId('lab-compare').click();
  await page.getByTestId('lab-search').click();
  const results = page.getByTestId('lab-results');
  for (const m of ['hybrid', 'vector', 'fulltext']) await expect(results.locator(`[data-method="${m}"]`).getByTestId('lab-hit').first()).toBeVisible();
  await expect(results.locator('[data-method="hybrid"]').getByTestId('lab-hit').first()).toContainText('Guía de despacho');
  await expect(results.locator('[data-method="fulltext"]').getByTestId('lab-hit').first()).toContainText('Regiones');

  const [doc] = await sql<{ id: string }>(`select id from rag.documents where collection_id = $1 and title = 'Guía de despacho'`, [state.collectionId]);
  await page.getByRole('tab', { name: 'Evaluaciones' }).click();
  await page.getByTestId('eval-new').click();
  const dialog = page.getByRole('dialog');
  await page.getByTestId('eval-name').fill(`Despacho ${run}`);
  // The new set starts with the collections selected for the search.
  await expect(dialog.getByLabel(names.collection)).toBeChecked();
  await page.getByTestId('eval-question').fill('¿Cuánto demora el despacho a regiones?');
  await page.getByTestId('eval-relevant').fill(doc!.id);
  await page.getByTestId('eval-save').click();
  const card = page.getByTestId(`eval-set-Despacho ${run}`);
  await card.getByTestId('eval-run').click();
  await page.getByTestId('eval-run-submit').click();
  await expect(page.getByText('Evaluación completada')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('eval-run-hybrid-k6').getByTestId('eval-recall')).toHaveText('100 %');
});

test('chat answers from the knowledge base with citations and records feedback', async ({ ownerPage: page }) => {
  await page.goto('/admin');
  const o = origin(page);
  const { chat } = await ensureAiModels(page);
  const agents = await api<{ id: string; isDefault: boolean }[]>(page.request, 'get', '/ai/agents', undefined, o);
  const agent = agents.find((a) => a.isDefault)!;
  const detail = await api<{ versions: { id: string; status: string }[] }>(
    page.request,
    'put',
    `/ai/agents/${agent.id}/draft`,
    { config: { model: { primaryModelId: chat }, knowledge: { mode: 'always', collectionIds: [state.collectionId], topK: 4 }, ui: { title: 'Asistente con conocimiento' } } },
    o,
  );
  await api(page.request, 'post', `/ai/agents/${agent.id}/publish`, { versionId: detail.versions.find((v) => v.status === 'draft')!.id }, o);

  await page.goto('/admin/knowledge/collections');
  await waitHydrated(page);
  await page.getByTestId('chat-launcher').click();
  await page.getByTestId('chat-new').click();
  await page.getByTestId('chat-input').fill('¿Cuándo se paga el bono de escolaridad?');
  await page.getByTestId('chat-send').click();
  const answer = page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
  await expect(answer).toContainText('Según la documentación', { timeout: 20_000 });
  await expect(answer.getByTestId('chat-citations')).toContainText('Beneficios');
  await answer.getByTestId('chat-thumbs-up').click();
  await expect(answer.getByTestId('chat-thumbs-up')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await sql<{ n: number }>(`select count(*)::int as n from answer_feedback f join messages m on m.id = f.message_id where f.rating = 1 and m.parts::text like '%escolaridad%'`))[0]!.n, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

  const [runRow] = await sql<{ used_in_answer: boolean; abstained: boolean }>(`select used_in_answer, abstained from retrieval_runs where origin = 'chat' and $1::uuid = any(collection_ids) order by created_at desc limit 1`, [state.collectionId]);
  expect(runRow).toMatchObject({ used_in_answer: true, abstained: false });

  await page.getByTestId('chat-close').click();
  await page.goto('/admin/knowledge/analytics');
  await waitHydrated(page);
  await expect(page.getByTestId('rag-stat-queries')).toContainText(/Consultas\s*[1-9]/);
  await expect(page.getByRole('row', { name: /bono de escolaridad/ })).toBeVisible();
});

test('reindex switches versions atomically and the collection is deleted with confirmation', async ({ ownerPage: page }) => {
  test.setTimeout(120_000);
  await page.goto(`/admin/knowledge/collections/${state.collectionId}`);
  await waitHydrated(page);
  const [before] = await sql<{ active_index_version_id: string }>(`select active_index_version_id from rag_collections where id = $1`, [state.collectionId]);
  await page.getByTestId('collection-reindex').click();
  await page.getByTestId('reindex-submit').click();
  await expect(page.getByText('Reindexación en cola')).toBeVisible();
  await expect
    .poll(async () => (await sql<{ v: string | null; b: string | null }>(`select active_index_version_id as v, building_index_version_id as b from rag_collections where id = $1`, [state.collectionId]))[0], { timeout: 60_000 })
    .toMatchObject({ b: null, v: expect.not.stringMatching(before!.active_index_version_id) });

  await page.goto('/admin/knowledge/jobs');
  await waitHydrated(page);
  await expect(page.getByTestId('job-row-reindex').first()).toHaveAttribute('data-status', 'succeeded');

  await page.goto(`/admin/knowledge/collections/${state.collectionId}`);
  await waitHydrated(page);
  await page.getByRole('tab', { name: 'Configuración' }).click();
  await page.getByTestId('collection-delete').click();
  const [slug] = await sql<{ slug: string }>(`select slug from rag_collections where id = $1`, [state.collectionId]);
  await expect(page.getByTestId('confirm-accept')).toBeDisabled();
  await page.getByTestId('confirm-type').fill(slug!.slug);
  await page.getByTestId('confirm-accept').click();
  await page.waitForURL(/\/admin\/knowledge\/collections$/);
  await expect.poll(async () => (await sql(`select 1 from rag_collections where id = $1`, [state.collectionId])).length, { timeout: 30_000 }).toBe(0);
  await expect.poll(async () => (await sql(`select 1 from rag.documents where collection_id = $1`, [state.collectionId])).length, { timeout: 30_000 }).toBe(0);
});
