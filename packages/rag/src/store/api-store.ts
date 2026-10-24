import { z } from 'zod';
import type { ChunkInput, DocumentInput, IndexSpace, RagStore, SearchHit, SearchInput, StoreCapabilities, StoreDiagnostic, StoredDocument } from './types.js';

/**
 * External retrieval API contract (documented in docs/rag-external.md):
 *   GET  {base}/capabilities → { search, ingest, delete, acl, hybrid }
 *   POST {base}/search       → { hits: [{ id, documentId, text, score, title?, url?, heading?, page? }] }
 *   PUT  {base}/documents/{externalId}?collection=…  (only when ingest)
 *   DELETE {base}/documents/{externalId}?collection=… (only when delete)
 * Authentication: `Authorization: Bearer <token>`. The starter sends the principal (user id and
 * roles) so a store that declares `acl` can filter; otherwise only organization-wide
 * collections should point to it.
 */
const Capabilities = z.object({
  search: z.boolean().default(true),
  ingest: z.boolean().default(false),
  delete: z.boolean().default(false),
  acl: z.boolean().default(false),
  hybrid: z.boolean().default(false),
});
const SearchResponse = z.object({
  hits: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        documentId: z.string().min(1).max(200),
        text: z.string().max(50_000),
        score: z.number(),
        title: z.string().max(500).nullable().optional(),
        url: z.string().max(2000).nullable().optional(),
        heading: z.string().max(500).nullable().optional(),
        page: z.number().int().nullable().optional(),
        collection: z.string().max(200).optional(),
      }),
    )
    .max(200),
});

export interface ApiStoreOptions {
  baseUrl: string;
  token: string | null;
  timeoutMs: number;
  /** Maps collection ids to the remote collection identifiers. */
  externalRefs: Map<string, string>;
  /** Validates every request URL (SSRF policy). */
  assertUrl: (url: string) => Promise<void>;
  /** Capabilities declared by the service at the last diagnostic. */
  capabilities?: StoreCapabilities | null;
}

export class ApiStore implements RagStore {
  readonly kind = 'api' as const;
  private caps: StoreCapabilities | null;

  constructor(private readonly opts: ApiStoreOptions) {
    this.caps = opts.capabilities ?? null;
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}${path}`;
    await this.opts.assertUrl(url);
    const res = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    if (!res.ok) throw new Error(`API de recuperación respondió ${res.status}`);
    const text = await res.text();
    if (text.length > 5_000_000) throw new Error('Respuesta demasiado grande');
    return text ? JSON.parse(text) : null;
  }

  async loadCapabilities(): Promise<StoreCapabilities> {
    const c = Capabilities.parse(await this.call('GET', '/capabilities'));
    this.caps = { search: c.search, vector: c.search, fullText: false, hybrid: c.hybrid, ingest: c.ingest, delete: c.delete, reindex: false, acl: c.acl, browse: false };
    return this.caps;
  }

  capabilities(): StoreCapabilities {
    return this.caps ?? { search: true, vector: true, fullText: false, hybrid: false, ingest: false, delete: false, reindex: false, acl: false, browse: false };
  }

  async diagnose(): Promise<StoreDiagnostic> {
    const t0 = Date.now();
    try {
      const caps = await this.loadCapabilities();
      const probe = SearchResponse.safeParse(await this.call('POST', '/search', { query: 'diagnóstico', collections: [], topK: 1, principal: { userId: null, roles: [] } }));
      return {
        ok: probe.success,
        checks: [
          { key: 'connection', label: 'Conexión', status: 'ok', detail: `${this.opts.baseUrl}` },
          { key: 'capabilities', label: 'Capacidades declaradas', status: 'ok', detail: Object.entries(caps).filter(([, v]) => v).map(([k]) => k).join(', ') },
          { key: 'search', label: 'Búsqueda de prueba', status: probe.success ? 'ok' : 'error', detail: probe.success ? 'Respuesta válida según el contrato' : 'La respuesta no cumple el contrato' },
          { key: 'acl', label: 'Control de acceso', status: caps.acl ? 'ok' : 'warn', detail: caps.acl ? 'El servicio filtra por persona' : 'No filtra por persona: úsalo solo en colecciones de toda la organización' },
        ],
        manualSteps: [],
        capabilities: caps,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        ok: false,
        checks: [{ key: 'connection', label: 'Conexión', status: 'error', detail: (err as Error).message.slice(0, 300) }],
        manualSteps: ['Verifica la URL base, el token y que el servicio implemente el contrato documentado en docs/rag-external.md'],
        capabilities: this.capabilities(),
        latencyMs: Date.now() - t0,
      };
    }
  }

  async search(input: SearchInput): Promise<SearchHit[]> {
    const collections = input.spaces.map((s) => this.opts.externalRefs.get(s.collectionId) ?? s.collectionId);
    const body = { query: input.query, collections, topK: input.topK, method: input.method === 'fulltext' ? 'keyword' : input.method, principal: { userId: input.principal.userId, roles: input.principal.roleKeys }, filters: input.filters ?? {} };
    const r = SearchResponse.parse(await this.call('POST', '/search', body));
    const byRef = new Map([...this.opts.externalRefs.entries()].map(([k, v]) => [v, k]));
    const first = input.spaces[0]?.collectionId ?? '';
    return r.hits
      .filter((h) => h.score >= input.minScore)
      .slice(0, input.topK)
      .map((h, i) => ({
        chunkId: h.id,
        documentId: h.documentId,
        collectionId: byRef.get(h.collection ?? '') ?? first,
        text: h.text,
        heading: h.heading ?? null,
        page: h.page ?? null,
        title: h.title ?? null,
        sourceUrl: h.url ?? null,
        score: h.score,
        scoreType: 'external' as const,
        vectorRank: i + 1,
        textRank: null,
      }));
  }

  async upsertDocument(doc: DocumentInput): Promise<{ document: StoredDocument; changed: boolean }> {
    if (!this.capabilities().ingest) throw new Error('La API externa no admite ingesta');
    const now = new Date();
    return {
      document: {
        id: doc.externalId,
        collectionId: doc.collectionId,
        sourceId: doc.sourceId,
        externalId: doc.externalId,
        title: doc.title,
        sourceUrl: doc.sourceUrl,
        mediaType: doc.mediaType,
        contentHash: doc.contentHash,
        storageKey: doc.storageKey,
        bytes: doc.bytes,
        version: 1,
        status: 'pending',
        aclRoles: doc.aclRoles,
        aclUsers: doc.aclUsers,
        metadata: doc.metadata,
        chunkCount: 0,
        error: null,
        createdAt: now,
        updatedAt: now,
        indexedAt: null,
      },
      changed: true,
    };
  }

  /** Remote ingestion: the service chunks and embeds; the starter sends normalized text. */
  async pushDocument(collectionId: string, externalId: string, payload: { title: string | null; url: string | null; text: string; metadata: Record<string, unknown>; acl: { roles: string[]; users: string[] } }) {
    const ref = this.opts.externalRefs.get(collectionId) ?? collectionId;
    await this.call('PUT', `/documents/${encodeURIComponent(externalId)}?collection=${encodeURIComponent(ref)}`, payload);
  }

  async setDocumentStatus(): Promise<void> {}
  async createIndexVersion(): Promise<string> {
    throw new Error('La API externa administra sus propios índices');
  }
  async ensureProfileIndex(): Promise<void> {}
  async replaceChunks(_d: string, _c: string, _s: IndexSpace, _chunks: ChunkInput[]): Promise<void> {
    throw new Error('La API externa administra sus propios fragmentos');
  }
  async activateIndexVersion(): Promise<{ retired: string[] }> {
    return { retired: [] };
  }
  async deleteIndexVersion(): Promise<void> {}
  async deleteDocument(id: string): Promise<{ storageKey: string | null }> {
    if (!this.capabilities().delete) throw new Error('La API externa no admite eliminar documentos');
    await this.call('DELETE', `/documents/${encodeURIComponent(id)}`);
    return { storageKey: null };
  }
  async deleteCollection(): Promise<{ storageKeys: string[] }> {
    return { storageKeys: [] };
  }
  async listDocuments(): Promise<{ items: StoredDocument[]; total: number }> {
    return { items: [], total: 0 };
  }
  async getDocument(): Promise<StoredDocument | null> {
    return null;
  }
  async findDocument(): Promise<StoredDocument | null> {
    return null;
  }
  async documentChunks() {
    return [];
  }
  async collectionStats() {
    return {};
  }
  async close(): Promise<void> {}
}
