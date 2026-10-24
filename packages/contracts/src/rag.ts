import { z } from 'zod';
import { IsoDate, PageQuery, pageOf, QueryBool, UsdAmount, Uuid } from './common.js';

export const RagConnectionKind = z.enum(['internal', 'postgres', 'api']).meta({ id: 'RagConnectionKind' });

export const StoreCapabilities = z
  .object({
    search: z.boolean(),
    vector: z.boolean(),
    fullText: z.boolean(),
    hybrid: z.boolean(),
    ingest: z.boolean(),
    delete: z.boolean(),
    reindex: z.boolean(),
    acl: z.boolean(),
    browse: z.boolean(),
  })
  .meta({ id: 'StoreCapabilities' });

export const StoreDiagnostic = z
  .object({
    ok: z.boolean(),
    checks: z.array(z.object({ key: z.string(), label: z.string(), status: z.enum(['ok', 'warn', 'error']), detail: z.string().nullable() })),
    manualSteps: z.array(z.string()),
    capabilities: StoreCapabilities,
    latencyMs: z.number().int(),
  })
  .meta({ id: 'StoreDiagnostic' });

export const RagConnection = z
  .object({
    id: Uuid,
    name: z.string(),
    kind: RagConnectionKind,
    status: z.enum(['pending', 'ready', 'error', 'disabled']),
    schema: z.string().nullable(),
    baseUrl: z.string().nullable(),
    access: z.enum(['read-write', 'read-only']),
    managed: z.boolean(),
    tls: z.enum(['disable', 'require', 'verify-full']),
    timeoutMs: z.number().int(),
    credentialSource: z.enum(['stored', 'reference', 'none', 'application']),
    credentialHint: z.string().nullable(),
    capabilities: StoreCapabilities.nullable(),
    diagnostic: StoreDiagnostic.nullable(),
    diagnosedAt: IsoDate.nullable(),
    enabledAt: IsoDate.nullable(),
    collections: z.number().int(),
    createdAt: IsoDate,
  })
  .meta({ id: 'RagConnection' });
export type RagConnection = z.infer<typeof RagConnection>;
export const RagConnectionList = z.array(RagConnection).meta({ id: 'RagConnectionList' });

const SecretRef = z.string().regex(/^(env|file):.+/, 'usa env:NOMBRE o file:/ruta');
const SchemaName = z.string().regex(/^[a-z_][a-z0-9_]{0,40}$/, 'minúsculas, números y _');

export const CreateRagConnectionInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: RagConnectionKind,
    schema: SchemaName.default('rag'),
    connectionUrl: z.string().max(2000).optional().meta({ description: 'postgres: connection string (write-only, stored encrypted)', writeOnly: true }),
    baseUrl: z.url().optional().meta({ description: 'api: base URL of the retrieval service' }),
    token: z.string().max(4096).optional().meta({ description: 'api: bearer token (write-only, stored encrypted)', writeOnly: true }),
    credentialRef: SecretRef.optional(),
    tls: z.enum(['disable', 'require', 'verify-full']).default('disable'),
    timeoutMs: z.number().int().min(1000).max(120_000).default(10_000),
    access: z.enum(['read-write', 'read-only']).default('read-write'),
    managed: z.boolean().default(true).meta({ description: 'Allow the starter to create the extension, schema and indexes on the target' }),
  })
  .meta({ id: 'CreateRagConnectionInput' });
export type CreateRagConnectionInput = z.infer<typeof CreateRagConnectionInput>;

export const UpdateRagConnectionInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    connectionUrl: z.string().max(2000).optional().meta({ writeOnly: true }),
    token: z.string().max(4096).optional().meta({ writeOnly: true }),
    credentialRef: SecretRef.nullable().optional(),
    baseUrl: z.url().optional(),
    tls: z.enum(['disable', 'require', 'verify-full']).optional(),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
    access: z.enum(['read-write', 'read-only']).optional(),
    managed: z.boolean().optional(),
    disabled: z.boolean().optional(),
  })
  .meta({ id: 'UpdateRagConnectionInput' });

export const EmbeddingProfile = z
  .object({
    id: Uuid,
    key: z.string(),
    name: z.string(),
    connectionId: Uuid,
    provider: z.string(),
    modelId: z.string(),
    modelCatalogId: Uuid.nullable(),
    dimensions: z.number().int(),
    metric: z.enum(['cosine', 'l2', 'inner_product']),
    indexType: z.string(),
    collections: z.number().int(),
    createdAt: IsoDate,
  })
  .meta({ id: 'EmbeddingProfile' });
export const EmbeddingProfileList = z.array(EmbeddingProfile).meta({ id: 'EmbeddingProfileList' });
export const CreateEmbeddingProfileInput = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
    name: z.string().trim().min(1).max(80),
    modelCatalogId: Uuid,
    metric: z.enum(['cosine', 'l2', 'inner_product']).default('cosine'),
    dimensions: z.number().int().min(8).max(16_000).optional().meta({ description: 'Only when the catalog does not declare it' }),
  })
  .meta({ id: 'CreateEmbeddingProfileInput' });

export const ChunkingConfig = z.object({ size: z.number().int().min(200).max(8000).default(1200), overlap: z.number().int().min(0).max(2000).default(150) }).meta({ id: 'ChunkingConfig' });
export const RetrievalConfig = z
  .object({ method: z.enum(['vector', 'fulltext', 'hybrid']).default('hybrid'), topK: z.number().int().min(1).max(50).default(6), minScore: z.number().min(0).max(1).default(0) })
  .meta({ id: 'RetrievalConfig' });

export const Collection = z
  .object({
    id: Uuid,
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    language: z.string(),
    connection: z.object({ id: Uuid, name: z.string(), kind: RagConnectionKind, status: z.string() }),
    profile: z.object({ id: Uuid, name: z.string(), modelId: z.string(), dimensions: z.number().int() }).nullable(),
    chunking: ChunkingConfig,
    retrieval: RetrievalConfig,
    visibility: z.enum(['organization', 'restricted']),
    aclRoles: z.array(z.string()),
    aclUsers: z.array(Uuid),
    retentionDays: z.number().int().nullable(),
    externalRef: z.string().nullable(),
    status: z.enum(['active', 'paused', 'deleting']),
    activeIndexVersionId: Uuid.nullable(),
    buildingIndexVersionId: Uuid.nullable(),
    stats: z.object({ documents: z.number().int(), indexed: z.number().int(), failed: z.number().int(), chunks: z.number().int(), bytes: z.number() }),
    sources: z.number().int(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
  })
  .meta({ id: 'Collection' });
export type Collection = z.infer<typeof Collection>;
export const CollectionsQuery = PageQuery.extend({ search: z.string().max(100).optional() });
export const CollectionsPage = pageOf(Collection, 'CollectionsPage');

export const CreateCollectionInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),
    description: z.string().max(1000).nullable().optional(),
    ragConnectionId: Uuid,
    embeddingProfileId: Uuid.nullable().optional(),
    language: z.enum(['spanish', 'english', 'portuguese', 'simple']).default('spanish'),
    chunking: ChunkingConfig.prefault({}),
    retrieval: RetrievalConfig.prefault({}),
    visibility: z.enum(['organization', 'restricted']).default('organization'),
    aclRoles: z.array(z.string().max(60)).max(50).default([]),
    aclUsers: z.array(Uuid).max(200).default([]),
    retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
    externalRef: z.string().max(200).nullable().optional().meta({ description: 'api connections: remote collection id' }),
  })
  .meta({ id: 'CreateCollectionInput' });
export type CreateCollectionInput = z.infer<typeof CreateCollectionInput>;
export const UpdateCollectionInput = CreateCollectionInput.omit({ slug: true, ragConnectionId: true })
  .partial()
  .extend({ status: z.enum(['active', 'paused']).optional() })
  .meta({ id: 'UpdateCollectionInput' });

export const SourceKind = z.enum(['upload', 'url', 'sitemap', 'text']).meta({ id: 'SourceKind' });
export const Source = z
  .object({
    id: Uuid,
    collectionId: Uuid,
    kind: SourceKind,
    name: z.string(),
    config: z.record(z.string(), z.unknown()),
    schedule: z.string().nullable(),
    status: z.enum(['active', 'paused', 'error', 'deleting']),
    lastSyncAt: IsoDate.nullable(),
    nextSyncAt: IsoDate.nullable(),
    lastError: z.string().nullable(),
    stats: z.record(z.string(), z.number()),
    createdAt: IsoDate,
  })
  .meta({ id: 'Source' });
export const SourceList = z.array(Source).meta({ id: 'SourceList' });
const Acl = z.object({ roles: z.array(z.string().max(60)).max(50).default([]), users: z.array(Uuid).max(200).default([]) }).prefault({});
export const CreateSourceInput = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('url'), name: z.string().trim().min(1).max(120), url: z.url(), schedule: z.string().max(100).nullable().optional(), acl: Acl }),
    z.object({
      kind: z.literal('sitemap'),
      name: z.string().trim().min(1).max(120),
      url: z.url(),
      maxUrls: z.number().int().min(1).max(5000).default(200),
      include: z.string().max(200).nullable().optional().meta({ description: 'Regular expression URLs must match' }),
      exclude: z.string().max(200).nullable().optional(),
      schedule: z.string().max(100).nullable().optional(),
      acl: Acl,
    }),
    z.object({ kind: z.literal('text'), name: z.string().trim().min(1).max(120), title: z.string().trim().min(1).max(300), text: z.string().min(1).max(500_000), acl: Acl }),
    z.object({ kind: z.literal('upload'), name: z.string().trim().min(1).max(120), acl: Acl }),
  ])
  .meta({ id: 'CreateSourceInput' });
export type CreateSourceInput = z.infer<typeof CreateSourceInput>;
export const UpdateSourceInput = z
  .object({ name: z.string().trim().min(1).max(120).optional(), schedule: z.string().max(100).nullable().optional(), status: z.enum(['active', 'paused']).optional() })
  .meta({ id: 'UpdateSourceInput' });

export const RagDocument = z
  .object({
    id: z.string(),
    collectionId: Uuid,
    collectionName: z.string(),
    sourceId: Uuid.nullable(),
    externalId: z.string(),
    title: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    mediaType: z.string().nullable(),
    bytes: z.number().nullable(),
    version: z.number().int(),
    status: z.enum(['pending', 'processing', 'indexed', 'failed', 'deleted']),
    chunkCount: z.number().int(),
    aclRoles: z.array(z.string()),
    aclUsers: z.array(z.string()),
    error: z.string().nullable(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
    indexedAt: IsoDate.nullable(),
  })
  .meta({ id: 'RagDocument' });
export const DocumentsQuery = PageQuery.extend({
  collectionId: Uuid.optional(),
  status: z.enum(['pending', 'processing', 'indexed', 'failed']).optional(),
  search: z.string().max(200).optional(),
});
export const DocumentsPage = pageOf(RagDocument, 'DocumentsPage');
export const DocumentDetail = RagDocument.extend({
  chunks: z.array(z.object({ id: z.string(), ordinal: z.number().int(), text: z.string(), heading: z.string().nullable(), page: z.number().int().nullable(), tokenCount: z.number().int().nullable() })),
}).meta({ id: 'DocumentDetail' });

export const RagJob = z
  .object({
    id: Uuid,
    kind: z.string(),
    status: z.enum(['queued', 'running', 'retrying', 'paused', 'succeeded', 'failed', 'cancelled']),
    stage: z.string().nullable(),
    progressCurrent: z.number().int(),
    progressTotal: z.number().int().nullable(),
    attempts: z.number().int(),
    maxAttempts: z.number().int(),
    collectionId: Uuid.nullable(),
    collectionName: z.string().nullable(),
    sourceId: Uuid.nullable(),
    documentId: z.string().nullable(),
    units: z.record(z.string(), z.number()),
    costUsd: UsdAmount,
    budgetUsd: UsdAmount.nullable(),
    error: z.string().nullable(),
    stageTimings: z.record(z.string(), z.number()),
    createdAt: IsoDate,
    startedAt: IsoDate.nullable(),
    finishedAt: IsoDate.nullable(),
    heartbeatAt: IsoDate.nullable(),
  })
  .meta({ id: 'RagJob' });
export const RagJobsQuery = PageQuery.extend({
  status: z.enum(['queued', 'running', 'retrying', 'paused', 'succeeded', 'failed', 'cancelled']).optional(),
  collectionId: Uuid.optional(),
  active: QueryBool.optional(),
});
export const RagJobsPage = pageOf(RagJob, 'RagJobsPage');

export const ReindexInput = z
  .object({ embeddingProfileId: Uuid.optional().meta({ description: 'New profile (model change); omitted = rebuild with the current one' }), budgetUsd: UsdAmount.optional() })
  .meta({ id: 'ReindexInput' });

export const SearchRequest = z
  .object({
    query: z.string().trim().min(1).max(2000),
    collectionIds: z.array(Uuid).min(1).max(20),
    method: z.enum(['vector', 'fulltext', 'hybrid']).default('hybrid'),
    topK: z.number().int().min(1).max(50).default(8),
    minScore: z.number().min(0).max(1).default(0),
  })
  .meta({ id: 'SearchRequest' });
export const SearchHitDto = z
  .object({
    chunkId: z.string(),
    documentId: z.string(),
    collectionId: Uuid,
    text: z.string(),
    heading: z.string().nullable(),
    page: z.number().int().nullable(),
    title: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    score: z.number(),
    scoreType: z.string(),
    vectorRank: z.number().int().nullable(),
    textRank: z.number().int().nullable(),
  })
  .meta({ id: 'SearchHit' });
export const SearchResult = z
  .object({ runId: Uuid.nullable(), method: z.string(), hits: z.array(SearchHitDto), latencyMs: z.number().int(), embeddingCostUsd: UsdAmount.nullable(), warnings: z.array(z.string()) })
  .meta({ id: 'SearchResult' });

export const EvaluationCase = z.object({
  id: z.string().min(1).max(60),
  question: z.string().trim().min(1).max(2000),
  relevantDocumentIds: z.array(z.string().max(200)).max(50).default([]),
  expectedAnswer: z.string().max(4000).optional(),
});
export const EvaluationSet = z
  .object({ id: Uuid, name: z.string(), description: z.string().nullable(), collectionIds: z.array(Uuid), cases: z.array(EvaluationCase), createdAt: IsoDate, updatedAt: IsoDate })
  .meta({ id: 'EvaluationSet' });
export const EvaluationSetList = z.array(EvaluationSet).meta({ id: 'EvaluationSetList' });
export const EvaluationSetInput = z
  .object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).nullable().optional(), collectionIds: z.array(Uuid).min(1).max(20), cases: z.array(EvaluationCase).min(1).max(200) })
  .meta({ id: 'EvaluationSetInput' });
export const EvaluationRunInput = z
  .object({ label: z.string().trim().min(1).max(60), method: z.enum(['vector', 'fulltext', 'hybrid']).default('hybrid'), topK: z.number().int().min(1).max(50).default(6) })
  .meta({ id: 'EvaluationRunInput' });
export const EvaluationRun = z
  .object({
    label: z.string(),
    method: z.string(),
    topK: z.number().int(),
    meanRecall: z.number().nullable(),
    meanLatencyMs: z.number().nullable(),
    costUsd: UsdAmount.nullable(),
    cases: z.array(z.object({ caseId: z.string(), question: z.string(), recallAtK: z.number().nullable(), retrievedDocumentIds: z.array(z.string()), latencyMs: z.number().int().nullable(), humanRating: z.number().int().nullable() })),
    createdAt: IsoDate,
  })
  .meta({ id: 'EvaluationRun' });
export const EvaluationRunList = z.array(EvaluationRun).meta({ id: 'EvaluationRunList' });
export const RateEvaluationInput = z
  .object({ runLabel: z.string(), caseId: z.string(), rating: z.number().int().min(1).max(5), notes: z.string().max(1000).optional() })
  .meta({ id: 'RateEvaluationInput' });

export const RagAnalytics = z
  .object({
    from: IsoDate,
    to: IsoDate,
    totals: z.object({
      queries: z.number().int(),
      abstained: z.number().int(),
      withoutHits: z.number().int(),
      avgLatencyMs: z.number().nullable(),
      p95LatencyMs: z.number().nullable(),
      embeddingCostUsd: UsdAmount,
      ingestionJobs: z.number().int(),
      failedJobs: z.number().int(),
      positiveFeedback: z.number().int(),
      negativeFeedback: z.number().int(),
    }),
    daily: z.array(z.object({ date: z.string(), queries: z.number().int(), abstained: z.number().int(), withoutHits: z.number().int(), avgLatencyMs: z.number().nullable(), ingested: z.number().int(), failed: z.number().int(), embeddingCostUsd: z.number() })),
    byCollection: z.array(z.object({ collectionId: Uuid, name: z.string(), queries: z.number().int(), documents: z.number().int(), chunks: z.number().int() })),
    topQueries: z.array(z.object({ query: z.string(), count: z.number().int(), withoutHits: z.number().int() })).nullable(),
    topDocuments: z.array(z.object({ documentId: z.string(), title: z.string().nullable(), hits: z.number().int(), cited: z.number().int() })),
  })
  .meta({ id: 'RagAnalytics' });
export const RagAnalyticsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30), collectionId: Uuid.optional() });

export const FeedbackInput = z.object({ rating: z.union([z.literal(1), z.literal(-1)]), comment: z.string().max(1000).optional() }).meta({ id: 'FeedbackInput' });
