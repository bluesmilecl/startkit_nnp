/**
 * Data plane of the knowledge base. A store keeps documents, chunks and vectors; the control
 * plane (connections, collections, sources, jobs, analytics) always lives in the application
 * database. Each implementation declares what it can do so the panel and the pipeline only
 * offer supported operations.
 */
export interface StoreCapabilities {
  search: boolean;
  vector: boolean;
  fullText: boolean;
  hybrid: boolean;
  /** Documents can be written (ingested) through the starter. */
  ingest: boolean;
  delete: boolean;
  reindex: boolean;
  /** Per-document ACL is enforced by the store at query time. */
  acl: boolean;
  /** Documents/chunks can be listed and inspected. */
  browse: boolean;
}

export interface DiagnosticCheck {
  key: string;
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string | null;
}

export interface StoreDiagnostic {
  ok: boolean;
  checks: DiagnosticCheck[];
  /** Manual steps (SQL or configuration) when the starter cannot fix something by itself. */
  manualSteps: string[];
  capabilities: StoreCapabilities;
  latencyMs: number;
}

export interface Principal {
  userId: string;
  roleKeys: string[];
}

export interface DocumentInput {
  organizationId: string;
  collectionId: string;
  sourceId: string | null;
  externalId: string;
  title: string | null;
  sourceUrl: string | null;
  mediaType: string | null;
  language: string | null;
  contentHash: string;
  storageKey: string | null;
  bytes: number | null;
  aclRoles: string[];
  aclUsers: string[];
  metadata: Record<string, unknown>;
}

export interface StoredDocument {
  id: string;
  collectionId: string;
  sourceId: string | null;
  externalId: string;
  title: string | null;
  sourceUrl: string | null;
  mediaType: string | null;
  contentHash: string | null;
  storageKey: string | null;
  bytes: number | null;
  version: number;
  status: 'pending' | 'processing' | 'indexed' | 'failed' | 'deleted';
  aclRoles: string[];
  aclUsers: string[];
  metadata: Record<string, unknown>;
  chunkCount: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  indexedAt: Date | null;
}

export interface ChunkInput {
  ordinal: number;
  text: string;
  heading: string | null;
  page: number | null;
  tokenCount: number;
  embedding: number[] | null;
  metadata?: Record<string, unknown>;
}

export interface IndexSpace {
  indexVersionId: string;
  profileId: string;
  dimensions: number;
  metric: 'cosine' | 'l2' | 'inner_product';
  indexType: string;
  tsConfig: string;
}

export interface SearchInput {
  method: 'vector' | 'fulltext' | 'hybrid';
  query: string;
  queryEmbedding: number[] | null;
  /** One entry per collection: the active index version to query. */
  spaces: (IndexSpace & { collectionId: string })[];
  topK: number;
  minScore: number;
  principal: Principal;
  filters?: { documentIds?: string[]; sourceIds?: string[] };
}

export interface SearchHit {
  chunkId: string;
  documentId: string;
  collectionId: string;
  text: string;
  heading: string | null;
  page: number | null;
  title: string | null;
  sourceUrl: string | null;
  score: number;
  /** Vector scores are similarities in [0, 1] (l2: 1 / (1 + distance)); labels name the metric. */
  scoreType: 'cosine_similarity' | 'l2_similarity' | 'inner_product' | 'vector_similarity' | 'ts_rank' | 'rrf' | 'external';
  vectorRank: number | null;
  textRank: number | null;
}

export interface RagStore {
  readonly kind: 'internal' | 'postgres' | 'api';
  diagnose(): Promise<StoreDiagnostic>;
  capabilities(): StoreCapabilities;
  search(input: SearchInput): Promise<SearchHit[]>;
  // Write side (only when capabilities().ingest)
  upsertDocument(doc: DocumentInput): Promise<{ document: StoredDocument; changed: boolean }>;
  setDocumentStatus(id: string, status: StoredDocument['status'], error?: string | null): Promise<void>;
  createIndexVersion(collectionId: string, space: Omit<IndexSpace, 'indexVersionId'>): Promise<string>;
  ensureProfileIndex(space: Omit<IndexSpace, 'indexVersionId' | 'tsConfig'>): Promise<void>;
  replaceChunks(documentId: string, collectionId: string, space: IndexSpace, chunks: ChunkInput[]): Promise<void>;
  activateIndexVersion(collectionId: string, indexVersionId: string): Promise<{ retired: string[] }>;
  deleteIndexVersion(indexVersionId: string): Promise<void>;
  deleteDocument(id: string, collectionId?: string | null): Promise<{ storageKey: string | null }>;
  deleteCollection(collectionId: string): Promise<{ storageKeys: string[] }>;
  // Browse side (only when capabilities().browse)
  /** `principal` filters by document ACL; null lists everything (knowledge managers). */
  listDocuments(q: { collectionId?: string; collectionIds: string[]; status?: string; search?: string; page: number; pageSize: number; principal?: Principal | null }): Promise<{ items: StoredDocument[]; total: number }>;
  getDocument(id: string): Promise<StoredDocument | null>;
  findDocument(collectionId: string, externalId: string): Promise<StoredDocument | null>;
  documentChunks(id: string, indexVersionId: string | null, limit: number): Promise<{ id: string; ordinal: number; text: string; heading: string | null; page: number | null; tokenCount: number | null }[]>;
  collectionStats(collectionIds: string[]): Promise<Record<string, { documents: number; indexed: number; failed: number; chunks: number; bytes: number }>>;
  close(): Promise<void>;
}
