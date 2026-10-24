import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * Reference implementation of the external retrieval API contract (docs/rag-external.md) for
 * development and E2E. In-memory keyword search with optional per-document ACL. It is a test
 * double for a third-party service, not part of the starter's runtime.
 *
 * It also serves a tiny static site under /site/ (pages + sitemap.xml, no token) so URL and
 * sitemap ingestion can be tested without internet access.
 *
 *   RETRIEVAL_TEST_PORT (3005) · RETRIEVAL_TEST_TOKEN (required bearer token, optional)
 */
if (process.env.NODE_ENV === 'production') {
  console.error('retrieval-test-server is a test double and does not run with NODE_ENV=production');
  process.exit(1);
}
interface Doc {
  id: string;
  collection: string;
  title: string;
  url: string | null;
  text: string;
  acl: { roles: string[]; users: string[] };
}

const docs = new Map<string, Doc>();
const seed: Omit<Doc, 'id'>[] = [
  { collection: 'soporte', title: 'Horario de soporte', url: 'https://example.com/soporte/horario', text: 'El soporte técnico atiende de lunes a viernes de 9:00 a 18:00 horas (hora de Chile).', acl: { roles: [], users: [] } },
  { collection: 'soporte', title: 'Restablecer contraseña', url: 'https://example.com/soporte/clave', text: 'Para restablecer el acceso se usa el código de un solo uso enviado al correo; no existen contraseñas.', acl: { roles: [], users: [] } },
  { collection: 'soporte', title: 'Escalamiento interno', url: null, text: 'Los incidentes críticos se escalan al equipo de guardia mediante el canal de emergencias.', acl: { roles: ['admin', 'owner'], users: [] } },
];
seed.forEach((d, i) => docs.set(`seed-${i + 1}`, { ...d, id: `seed-${i + 1}` }));

const SITE: Record<string, { type: string; body: (base: string) => string }> = {
  '/site/sitemap.xml': {
    type: 'application/xml',
    body: (base) =>
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/site/guia.html</loc></url><url><loc>${base}/site/faq.html</loc></url><url><loc>${base}/site/privado/notas.html</loc></url></urlset>`,
  },
  '/site/guia.html': {
    type: 'text/html; charset=utf-8',
    body: () =>
      '<!doctype html><html lang="es"><head><title>Guía de despacho</title><script>alert(1)</script></head><body><nav>Menú</nav><main><h1>Guía de despacho</h1><p>Los pedidos confirmados antes de las 14:00 se despachan el mismo día hábil.</p><h2>Regiones</h2><p>El despacho a regiones demora entre dos y cuatro días hábiles.</p></main><footer>Pie</footer></body></html>',
  },
  '/site/faq.html': {
    type: 'text/html; charset=utf-8',
    body: () => '<!doctype html><html lang="es"><head><title>Preguntas frecuentes</title></head><body><article><h1>Preguntas frecuentes</h1><p>Las devoluciones se aceptan dentro de 30 días corridos con la boleta.</p></article></body></html>',
  },
  '/site/privado/notas.html': {
    type: 'text/html; charset=utf-8',
    body: () => '<!doctype html><html lang="es"><head><title>Notas internas</title></head><body><p>Contenido que la fuente excluye con su expresión regular.</p></body></html>',
  },
};

const token = process.env.RETRIEVAL_TEST_TOKEN || null;
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const terms = (s: string) => norm(s).match(/[a-z0-9]{3,}/g) ?? [];

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 2_000_000) throw new Error('too large');
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  try {
    const page = req.method === 'GET' ? SITE[(req.url ?? '').split('?')[0]!] : undefined;
    if (page) return res.writeHead(200, { 'content-type': page.type }).end(page.body(`http://${req.headers.host ?? 'localhost'}`));
    if (token && req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: 'unauthorized' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/capabilities') return send(res, 200, { search: true, ingest: true, delete: true, acl: true, hybrid: false });
    if (req.method === 'POST' && url.pathname === '/search') {
      const q = (await body(req)) as { query: string; collections: string[]; topK: number; principal?: { userId: string | null; roles: string[] } };
      const qt = terms(q.query ?? '');
      const roles = q.principal?.roles ?? [];
      const user = q.principal?.userId ?? null;
      const hits = [...docs.values()]
        .filter((d) => !q.collections?.length || q.collections.includes(d.collection))
        .filter((d) => (!d.acl.roles.length && !d.acl.users.length) || d.acl.roles.some((r) => roles.includes(r)) || (user !== null && d.acl.users.includes(user)))
        .map((d) => {
          const dt = new Set(terms(`${d.title} ${d.text}`));
          const matched = qt.filter((t) => dt.has(t)).length;
          return { d, score: qt.length ? matched / qt.length : 0 };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.min(50, q.topK ?? 5))
        .map(({ d, score }) => ({ id: `${d.id}#0`, documentId: d.id, text: d.text, score, title: d.title, url: d.url, collection: d.collection }));
      return send(res, 200, { hits });
    }
    const m = url.pathname.match(/^\/documents\/(.+)$/);
    if (m && req.method === 'PUT') {
      const p = (await body(req)) as { title: string | null; url: string | null; text: string; acl?: { roles: string[]; users: string[] } };
      const id = decodeURIComponent(m[1]!);
      docs.set(id, { id, collection: url.searchParams.get('collection') ?? 'default', title: p.title ?? id, url: p.url, text: p.text, acl: p.acl ?? { roles: [], users: [] } });
      return send(res, 200, { ok: true });
    }
    if (m && req.method === 'DELETE') {
      docs.delete(decodeURIComponent(m[1]!));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/health') return send(res, 200, { status: 'ok', documents: docs.size });
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 400, { error: (err as Error).message });
  }
});

const port = Number(process.env.RETRIEVAL_TEST_PORT ?? 3005);
server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ msg: 'retrieval test server listening', port, documents: docs.size }));
});
