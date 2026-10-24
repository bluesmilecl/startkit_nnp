import { createAiServices, type AiServices } from '@starter/ai';
import type { Actor } from '@starter/auth';
import { SecretBox } from '@starter/config';
import { CreateCollectionInput, CreateRagConnectionInput, CreateSourceInput } from '@starter/contracts';
import { aiRequests, and, eq, ragCollections, ragJobs, retrievalHits, retrievalRuns } from '@starter/db';
import type { JobQueue } from '@starter/jobs';
import { createRagServices, type RagServices } from '@starter/rag';
import { createStorage } from '@starter/storage';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor, deps, makeUser, testContext } from './helpers.js';

/**
 * Knowledge (RAG) end to end at the service layer: real PostgreSQL + pgvector stores (internal
 * schema and an external database), the external retrieval API test double, the AI runtime
 * with the deterministic provider (ledger and cost) and the ingestion pipeline. Only the job
 * queue transport is replaced by an in-memory queue drained synchronously.
 */
let ctx: Awaited<ReturnType<typeof testContext>>;
let ai: AiServices;
let rag: RagServices;
let owner: Actor;
let editor: Actor;
let viewer: Actor;
let profileId: string;
let internalId: string;
let server: ChildProcess;
let serverUrl: string;
let externalDbUrl: string;
const TOKEN = 'it-token';
const queue: { ragJobId: string; retry: number }[] = [];

const fakeQueue = {
  async send(_queue: string, data: { ragJobId: string }) {
    queue.push({ ragJobId: data.ragJobId, retry: 0 });
    return randomUUID();
  },
  async cancel() {},
} as unknown as JobQueue;

/** Runs queued jobs (and the jobs they enqueue) like the worker, retrying like pg-boss. */
async function drain(): Promise<void> {
  for (let guard = 0; queue.length && guard < 200; guard++) {
    const item = queue.shift()!;
    try {
      await rag.ingestion.run(item.ragJobId, item.retry);
    } catch {
      queue.push({ ragJobId: item.ragJobId, retry: item.retry + 1 });
    }
  }
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    return (err as { code?: string }).code ?? (err as Error).message;
  }
}

const docTitles = async (actor: Actor, collectionId: string) => (await rag.documents.list(actor, { collectionId })).items.map((d) => d.title).sort();
const searchTitles = async (actor: Actor, collectionId: string, query: string, method: 'vector' | 'fulltext' | 'hybrid' = 'hybrid') =>
  (await rag.retrieval.search(actor, { query, collectionIds: [collectionId], method, topK: 5, origin: 'playground', management: true })).hits.map((h) => h.title);

async function collection(name: string, extra: Partial<Record<string, unknown>> = {}) {
  return rag.collections.create(owner, CreateCollectionInput.parse({ name, slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`, ragConnectionId: internalId, embeddingProfileId: profileId, chunking: { size: 400, overlap: 40 }, ...extra }));
}
async function textSource(collectionId: string, title: string, text: string, acl = { roles: [] as string[], users: [] as string[] }) {
  const s = await rag.sources.create(owner, collectionId, CreateSourceInput.parse({ kind: 'text', name: title, title, text, acl }));
  await drain();
  return s;
}

beforeAll(async () => {
  ctx = await testContext();
  const env = { ...ctx.env, RAG_FETCH_ALLOW_PRIVATE: true };
  const d = { ...deps(env, ctx.handle), secrets: new SecretBox(ctx.env.APP_ENCRYPTION_KEY) };
  ai = createAiServices(d);
  rag = createRagServices({ ...d, storage: createStorage(ctx.env), jobs: fakeQueue, ai });
  owner = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['owner'] })).id);
  editor = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['editor'] })).id);
  viewer = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['viewer'] })).id);

  const conn = await ai.connections.create(owner, { provider: 'test', alias: `rag-${Date.now()}`, options: {} } as never);
  await ai.models.sync(owner, conn.id, owner.organizationId);
  await ai.prices.syncFromCatalog(null);
  const models = await ai.models.list(owner, { page: 1, pageSize: 50, connectionId: conn.id } as never);
  const embedding = models.items.find((m) => m.modelId === 'test-embedding-64')!;
  profileId = (await rag.profiles.create(owner, { key: `it-64-${Date.now().toString(36)}`, name: 'IT 64', modelCatalogId: embedding.id, metric: 'cosine' })).id;

  // External retrieval API test double on a free port.
  const port = 39000 + Math.floor(Math.random() * 2000);
  serverUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [new URL('../../apps/api/dist/scripts/retrieval-test-server.js', import.meta.url).pathname], { env: { ...process.env, RETRIEVAL_TEST_PORT: String(port), RETRIEVAL_TEST_TOKEN: TOKEN, NODE_ENV: 'test' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${serverUrl}/site/faq.html`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Separate database playing the external PostgreSQL + pgvector store.
  const base = new URL(process.env.__IT_DATABASE_URL!);
  const name = `${base.pathname.slice(1)}_ragext`;
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.query(`create database "${name}"`);
  await admin.end();
  base.pathname = `/${name}`;
  externalDbUrl = base.toString();
});

afterAll(() => {
  server?.kill();
});

describe('internal store (same database)', () => {
  it('activates pgvector, migrates the schema and reports capabilities', async () => {
    const c = await rag.connections.create(owner, CreateRagConnectionInput.parse({ name: `Interna ${Date.now()}`, kind: 'internal', schema: 'rag' }));
    internalId = c.id;
    const ready = await rag.connections.activate(owner, c.id);
    expect(ready.status).toBe('ready');
    expect(ready.diagnostic?.checks.find((x) => x.key === 'pgvector')?.status).toBe('ok');
    expect(ready.capabilities).toMatchObject({ vector: true, fullText: true, hybrid: true, ingest: true, acl: true, browse: true, reindex: true });
    // Diagnosis is repeatable and read-only.
    expect((await rag.connections.diagnose(owner, c.id)).status).toBe('ready');
  });

  it('ingests text through durable jobs with cost in the ledger and job', async () => {
    const col = await collection('Manual');
    await textSource(col.id, 'Política de vacaciones', '# Vacaciones\n\nCada persona tiene quince días hábiles de vacaciones al año.\n\n## Solicitud\n\nSe solicitan con dos semanas de anticipación en el portal.');
    const docs = await rag.documents.list(owner, { collectionId: col.id });
    expect(docs.items).toHaveLength(1);
    expect(docs.items[0]).toMatchObject({ title: 'Política de vacaciones', status: 'indexed' });
    expect(docs.items[0]!.chunkCount).toBeGreaterThanOrEqual(2);

    const jobs = await ctx.handle.db.select().from(ragJobs).where(eq(ragJobs.collectionId, col.id));
    expect(jobs.map((j) => [j.kind, j.status]).sort()).toEqual([
      ['ingest-document', 'succeeded'],
      ['ingest-source', 'succeeded'],
    ]);
    const ingest = jobs.find((j) => j.kind === 'ingest-document')!;
    expect(Number(ingest.costUsd)).toBeGreaterThan(0);
    const ledger = await ctx.handle.db.select().from(aiRequests).where(and(eq(aiRequests.jobId, ingest.id), eq(aiRequests.feature, 'embedding')));
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.every((r) => r.status === 'succeeded' && r.costStatus !== 'unknown')).toBe(true);

    // Chunks keep their heading path; the detail view returns them in order.
    const detail = await rag.documents.get(owner, col.id, docs.items[0]!.id);
    expect(detail.chunks.map((c) => c.heading)).toContain('Vacaciones › Solicitud');
  });

  it('skips unchanged content and re-embeds on change', async () => {
    const col = await collection('Idempotencia');
    const s = await textSource(col.id, 'Horario', 'La oficina abre de lunes a viernes de 9 a 18 horas.');
    const before = (await rag.documents.list(owner, { collectionId: col.id })).items[0]!;
    await rag.sources.sync(owner, s.id);
    await drain();
    const again = (await rag.documents.list(owner, { collectionId: col.id })).items[0]!;
    expect(again.version).toBe(before.version);
    const last = (await ctx.handle.db.select().from(ragJobs).where(and(eq(ragJobs.collectionId, col.id), eq(ragJobs.kind, 'ingest-document')))).sort((a, b) => +b.createdAt - +a.createdAt)[0]!;
    expect(last.stage).toBe('unchanged');
    expect(Number(last.costUsd)).toBe(0);
  });

  it('searches with vector, full-text and hybrid fusion', async () => {
    const col = await collection('Búsqueda');
    await textSource(col.id, 'Despacho', 'Los pedidos confirmados antes de las 14:00 se despachan el mismo día hábil.');
    await textSource(col.id, 'Devoluciones', 'Las devoluciones se aceptan dentro de treinta días corridos con la boleta.');
    expect((await searchTitles(owner, col.id, 'devoluciones boleta', 'fulltext'))[0]).toBe('Devoluciones');
    expect((await searchTitles(owner, col.id, '¿Cuándo despachan los pedidos?', 'hybrid'))[0]).toBe('Despacho');
    const vector = await rag.retrieval.search(owner, { query: 'devoluciones', collectionIds: [col.id], method: 'vector', topK: 2, origin: 'playground', management: true });
    expect(vector.hits).toHaveLength(2);
    expect(vector.hits[0]!.scoreType).toBe('cosine_similarity');
    expect(vector.embeddingCostUsd).not.toBeNull();
    // Every search is recorded with its hits (title included for analytics).
    const [run] = await ctx.handle.db.select().from(retrievalRuns).where(eq(retrievalRuns.id, vector.runId!));
    expect(run).toMatchObject({ origin: 'playground', method: 'vector', hitCount: 2 });
    const hits = await ctx.handle.db.select().from(retrievalHits).where(eq(retrievalHits.runId, vector.runId!));
    expect(hits.every((h) => h.title)).toBe(true);
  });

  it('enforces collection and document ACLs in search and document views', async () => {
    const open = await collection('Abierta');
    await textSource(open.id, 'Pública', 'El casino atiende de 12 a 15 horas.');
    await textSource(open.id, 'Salarios', 'La banda salarial del casino se revisa en marzo.', { roles: ['admin', 'owner'], users: [] });
    const restricted = await collection('Restringida', { visibility: 'restricted', aclRoles: ['admin'] });
    await textSource(restricted.id, 'Directorio', 'El directorio sesiona el primer lunes del casino.');

    // Document ACL: the viewer neither retrieves nor browses the restricted document.
    expect(await searchTitles(viewer, open.id, 'casino')).toEqual(['Pública']);
    expect((await searchTitles(owner, open.id, 'casino')).sort()).toEqual(['Pública', 'Salarios']);
    expect(await docTitles(viewer, open.id)).toEqual(['Pública']);
    expect(await docTitles(owner, open.id)).toEqual(['Pública', 'Salarios']);
    const secret = (await rag.documents.list(owner, { collectionId: open.id })).items.find((d) => d.title === 'Salarios')!;
    expect(await code(rag.documents.get(viewer, open.id, secret.id))).toBe('NOT_FOUND');

    // Collection ACL: role-restricted collections are invisible to other roles (even in chat retrieval).
    const viewerRun = await rag.retrieval.search(viewer, { query: 'directorio', collectionIds: [restricted.id], origin: 'chat' });
    expect(viewerRun.hits).toHaveLength(0);
    expect(viewerRun.warnings.join(' ')).toMatch(/no tienes acceso/);
    expect((await rag.collections.list(viewer, {})).items.map((c) => c.id)).not.toContain(restricted.id);
    expect(await code(rag.collections.get(viewer, restricted.id))).toBe('NOT_FOUND');

    // Editors manage sources but not connections or collections.
    expect(await code(rag.connections.create(editor, CreateRagConnectionInput.parse({ name: 'x', kind: 'internal' })))).toBe('FORBIDDEN');
    expect(await code(rag.collections.reindex(editor, open.id, {}))).toBe('FORBIDDEN');
    expect(await code(rag.sources.create(viewer, open.id, CreateSourceInput.parse({ kind: 'text', name: 'x', title: 'x', text: 'x', acl: { roles: [], users: [] } })))).toBe('FORBIDDEN');
  });

  it('ingests pages and sitemaps with include/exclude rules and strips boilerplate', async () => {
    const col = await collection('Sitio');
    await rag.sources.create(owner, col.id, CreateSourceInput.parse({ kind: 'sitemap', name: 'Sitio', url: `${serverUrl}/site/sitemap.xml`, maxUrls: 10, exclude: 'privado', acl: { roles: [], users: [] } }));
    await drain();
    expect(await docTitles(owner, col.id)).toEqual(['Guía de despacho', 'Preguntas frecuentes']);
    const guide = (await rag.documents.list(owner, { collectionId: col.id, search: 'despacho' })).items[0]!;
    const text = (await rag.documents.get(owner, col.id, guide.id)).chunks.map((c) => c.text).join('\n');
    expect(text).toContain('mismo día hábil');
    expect(text).not.toMatch(/alert|Menú|Pie/);
    const [src] = await rag.sources.list(owner, col.id);
    expect(src!.stats).toMatchObject({ discovered: 2, added: 2 });
  });

  it('blocks private network fetches unless explicitly allowed (SSRF)', async () => {
    const strict = createRagServices({ ...deps(ctx.env, ctx.handle), secrets: new SecretBox(ctx.env.APP_ENCRYPTION_KEY), storage: createStorage(ctx.env), jobs: fakeQueue, ai });
    expect(await code(strict.connections.create(owner, CreateRagConnectionInput.parse({ name: `api-ssrf-${Date.now()}`, kind: 'api', baseUrl: serverUrl })))).toBe('VALIDATION_FAILED');
    const col = await collection('SSRF');
    await strict.sources.create(owner, col.id, CreateSourceInput.parse({ kind: 'url', name: 'meta', url: 'http://169.254.169.254/latest/meta-data', acl: { roles: [], users: [] } }));
    await strict.sources.create(owner, col.id, CreateSourceInput.parse({ kind: 'url', name: 'local', url: `${serverUrl}/site/faq.html`, acl: { roles: [], users: [] } }));
    const saved = rag;
    rag = strict;
    try {
      await drain();
    } finally {
      rag = saved;
    }
    const jobs = await ctx.handle.db.select().from(ragJobs).where(and(eq(ragJobs.collectionId, col.id), eq(ragJobs.kind, 'ingest-document')));
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.status === 'failed')).toBe(true);
    expect(jobs.map((j) => j.error).join(' ')).toMatch(/no permitido/);
    expect(jobs.map((j) => j.error).join(' ')).toMatch(/RAG_FETCH_ALLOW_PRIVATE/);
    expect(await docTitles(owner, col.id)).toEqual(expect.not.arrayContaining(['Preguntas frecuentes']));
  });

  it('reindexes into a new version and switches atomically', async () => {
    const col = await collection('Reindex');
    await textSource(col.id, 'Garantía', 'La garantía legal cubre seis meses desde la compra.');
    const before = await rag.collections.get(owner, col.id);
    const profiles = await rag.profiles.list(owner);
    const base = profiles.find((p) => p.id === profileId)!;
    const l2 = await rag.profiles.create(owner, { key: `it-l2-${Date.now().toString(36)}`, name: 'IT L2', modelCatalogId: base.modelCatalogId!, metric: 'l2' });
    await rag.collections.reindex(owner, col.id, { embeddingProfileId: l2.id });
    // Searches keep using the active version until the switch.
    expect((await rag.collections.get(owner, col.id)).activeIndexVersionId).toBe(before.activeIndexVersionId);
    expect(await searchTitles(owner, col.id, 'garantía', 'vector')).toEqual(['Garantía']);
    await drain();
    const after = await rag.collections.get(owner, col.id);
    expect(after.activeIndexVersionId).not.toBe(before.activeIndexVersionId);
    expect(after.buildingIndexVersionId).toBeNull();
    expect(after.profile?.id).toBe(l2.id);
    expect(await searchTitles(owner, col.id, 'garantía', 'vector')).toEqual(['Garantía']);
  });

  it('stops a job at its budget and supports cancel and retry', async () => {
    const col = await collection('Presupuesto');
    await textSource(col.id, 'Base', 'Texto base para presupuesto de reindexación.');
    await rag.collections.reindex(owner, col.id, { budgetUsd: '0.000000000001' });
    await drain();
    const [failed] = await ctx.handle.db.select().from(ragJobs).where(and(eq(ragJobs.collectionId, col.id), eq(ragJobs.kind, 'reindex')));
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed!.error).toMatch(/presupuesto/);
    expect((await rag.collections.get(owner, col.id)).buildingIndexVersionId).toBeNull();

    const queued = await rag.collections.reindex(owner, col.id, {});
    const cancelled = await rag.jobs.cancel(owner, queued.jobId);
    expect(cancelled.status).toBe('cancelled');
    await drain();
    expect((await rag.jobs.get(owner, queued.jobId)).status).toBe('cancelled');
    const retried = await rag.jobs.retry(owner, queued.jobId);
    await drain();
    expect((await rag.jobs.get(owner, retried.id)).status).toBe('succeeded');
  });

  it('measures recall@k with evaluation sets and records human ratings', async () => {
    const col = await collection('Evaluación');
    await textSource(col.id, 'Seguro', 'El seguro complementario cubre consultas dentales.');
    await textSource(col.id, 'Bono', 'El bono de escolaridad se paga en marzo.');
    const docs = await rag.documents.list(owner, { collectionId: col.id });
    const bono = docs.items.find((d) => d.title === 'Bono')!;
    const set = await rag.retrieval.saveEvaluationSet(owner, null, { name: 'Beneficios', collectionIds: [col.id], cases: [{ id: 'c1', question: '¿Cuándo se paga el bono de escolaridad?', relevantDocumentIds: [bono.id] }] });
    const run = await rag.retrieval.runEvaluation(owner, set.id, { label: 'hybrid-k1', method: 'hybrid', topK: 1 });
    expect(run.meanRecall).toBe(1);
    await rag.retrieval.rateEvaluation(owner, set.id, { runLabel: 'hybrid-k1', caseId: 'c1', rating: 5 });
    expect((await rag.retrieval.evaluationRuns(owner, set.id))[0]!.cases[0]!.humanRating).toBe(5);
    expect(await code(rag.retrieval.evaluationSets(viewer))).toBe('FORBIDDEN');
  });

  it('marks answers and citations for analytics', async () => {
    const col = await collection('Analítica');
    await textSource(col.id, 'Estacionamiento', 'El estacionamiento de visitas está en el subterráneo -2.');
    const provider = rag.retrieval.knowledgeProvider();
    const r = await provider.retrieve(viewer, { collectionIds: [col.id], query: '¿Dónde estaciono?', topK: 3, minScore: 0, agentId: null, conversationId: null, aiRequestId: null });
    expect(r.hits[0]?.title).toBe('Estacionamiento');
    await provider.afterAnswer!({ runIds: [r.retrievalRunId!], citedChunkIds: [r.hits[0]!.chunkId!], abstained: false });
    const [run] = await ctx.handle.db.select().from(retrievalRuns).where(eq(retrievalRuns.id, r.retrievalRunId!));
    expect(run).toMatchObject({ origin: 'chat', usedInAnswer: true, abstained: false });
    const a = await rag.retrieval.analytics(owner, { days: 1, collectionId: col.id });
    expect(a.totals.queries).toBe(1);
    expect(a.topDocuments[0]).toMatchObject({ title: 'Estacionamiento', cited: 1 });
    expect(a.topQueries?.[0]?.query).toBe('¿dónde estaciono?');
  });

  it('deletes documents and purges collections from store and storage', async () => {
    const col = await collection('Purga');
    await textSource(col.id, 'Uno', 'Documento uno sobre la purga.');
    await textSource(col.id, 'Dos', 'Documento dos sobre la purga.');
    const [uno] = (await rag.documents.list(owner, { collectionId: col.id, search: 'Uno' })).items;
    await rag.documents.remove(owner, col.id, uno!.id);
    await drain();
    expect(await docTitles(owner, col.id)).toEqual(['Dos']);
    expect(await searchTitles(owner, col.id, 'purga', 'fulltext')).toEqual(['Dos']);
    await rag.collections.remove(owner, col.id);
    await drain();
    expect(await ctx.handle.db.select().from(ragCollections).where(eq(ragCollections.id, col.id))).toHaveLength(0);
  });
});

describe('external PostgreSQL store', () => {
  it('prepares a separate pgvector database and indexes into it', async () => {
    const c = await rag.connections.create(owner, CreateRagConnectionInput.parse({ name: `PG externo ${Date.now()}`, kind: 'postgres', connectionUrl: externalDbUrl, schema: 'conocimiento' }));
    const password = new URL(externalDbUrl).password;
    expect(c.credentialHint).toBeTruthy();
    if (password) expect(c.credentialHint).not.toContain(`:${password}@`);
    expect((await rag.connections.activate(owner, c.id)).status).toBe('ready');
    const col = await rag.collections.create(owner, CreateCollectionInput.parse({ name: 'Externa', slug: `externa-${randomUUID().slice(0, 6)}`, ragConnectionId: c.id, embeddingProfileId: profileId }));
    await textSource(col.id, 'Teletrabajo', 'El teletrabajo se coordina con la jefatura directa.');
    expect(await searchTitles(owner, col.id, 'teletrabajo jefatura')).toEqual(['Teletrabajo']);
    const ext = new pg.Client({ connectionString: externalDbUrl });
    await ext.connect();
    const { rows } = await ext.query<{ n: number }>(`select count(*)::int as n from conocimiento.chunks`);
    await ext.end();
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});

describe('external retrieval API', () => {
  it('discovers capabilities, searches with the principal and respects remote ACL', async () => {
    const c = await rag.connections.create(owner, CreateRagConnectionInput.parse({ name: `API ${Date.now()}`, kind: 'api', baseUrl: serverUrl, token: TOKEN }));
    expect(c.credentialHint).not.toBe(TOKEN);
    const ready = await rag.connections.activate(owner, c.id);
    expect(ready.status).toBe('ready');
    expect(ready.capabilities).toMatchObject({ vector: true, ingest: true, delete: true, acl: true, hybrid: false, browse: false });
    const col = await rag.collections.create(owner, CreateCollectionInput.parse({ name: 'Soporte', slug: `soporte-${randomUUID().slice(0, 6)}`, ragConnectionId: c.id, externalRef: 'soporte' }));
    expect(await searchTitles(viewer, col.id, 'escalamiento incidentes críticos guardia')).not.toContain('Escalamiento interno');
    expect(await searchTitles(owner, col.id, 'escalamiento incidentes críticos guardia')).toContain('Escalamiento interno');
    const hybrid = await rag.retrieval.search(owner, { query: 'horario soporte', collectionIds: [col.id], method: 'hybrid', origin: 'playground', management: true });
    expect(hybrid.hits[0]?.title).toBe('Horario de soporte');
    expect(hybrid.warnings.join(' ')).toMatch(/no soporta búsqueda híbrida/);
  });

  it('rejects a wrong token with a clear diagnostic', async () => {
    const c = await rag.connections.create(owner, CreateRagConnectionInput.parse({ name: `API mala ${Date.now()}`, kind: 'api', baseUrl: serverUrl, token: 'incorrecto' }));
    const r = await rag.connections.activate(owner, c.id);
    expect(r.status).not.toBe('ready');
    expect(JSON.stringify(r.diagnostic)).toMatch(/401|autoriz|credencial/i);
  });
});
