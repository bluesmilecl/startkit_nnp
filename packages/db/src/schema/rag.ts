import { boolean, index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, ts, updatedAt } from './_helpers.js';
import { organizations } from './access.js';
import { providerConnections } from './ai.js';

/**
 * RAG control plane. Lives in the transactional database regardless of where the knowledge is
 * stored (internal schema, external PostgreSQL or external retrieval API). The data plane
 * (documents, chunks, embeddings) is managed by @starter/rag in the `rag` schema of the
 * selected store, so no cross-database joins are ever required.
 */
export const ragConnections = pgTable(
  'rag_connections',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** internal | postgres | api */
    kind: text('kind').notNull(),
    /** internal: same-database | same-server | other-server */
    location: text('location'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    credentialCiphertext: text('credential_ciphertext'),
    credentialRef: text('credential_ref'),
    tls: text('tls', { enum: ['disable', 'require', 'verify-full'] })
      .notNull()
      .default('disable'),
    timeoutMs: integer('timeout_ms').notNull().default(10_000),
    /** read-write | read-only */
    access: text('access').notNull().default('read-write'),
    /** True when the starter is allowed to create schema/extension/indexes on the target. */
    managed: boolean('managed').notNull().default(false),
    capabilities: jsonb('capabilities').$type<Record<string, boolean>>().notNull().default({}),
    status: text('status', { enum: ['pending', 'ready', 'error', 'disabled'] })
      .notNull()
      .default('pending'),
    diagnostic: jsonb('diagnostic'),
    diagnosedAt: ts('diagnosed_at'),
    enabledAt: ts('enabled_at'),
    enabledBy: uuid('enabled_by'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('rag_connections_name_uq').on(t.organizationId, t.name)],
);

/** A vector space definition. Changing model/dimension means a new profile + reindex. */
export const embeddingProfiles = pgTable(
  'embedding_profiles',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    dimensions: integer('dimensions').notNull(),
    metric: text('metric', { enum: ['cosine', 'l2', 'inner_product'] })
      .notNull()
      .default('cosine'),
    normalize: boolean('normalize').notNull().default(true),
    version: integer('version').notNull().default(1),
    /** hnsw (vector <= 2000 dims) | hnsw_halfvec (<= 4000 dims) | none (exact search) */
    indexType: text('index_type').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('embedding_profiles_key_uq').on(t.organizationId, t.key)],
);

export const ragCollections = pgTable(
  'rag_collections',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ragConnectionId: uuid('rag_connection_id')
      .notNull()
      .references(() => ragConnections.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    language: text('language').notNull().default('spanish'),
    embeddingProfileId: uuid('embedding_profile_id').references(() => embeddingProfiles.id, { onDelete: 'restrict' }),
    chunking: jsonb('chunking').$type<Record<string, unknown>>().notNull().default({}),
    retrieval: jsonb('retrieval').$type<Record<string, unknown>>().notNull().default({}),
    /** organization: every member with rag.documents.read; restricted: only listed roles/users. */
    visibility: text('visibility', { enum: ['organization', 'restricted'] })
      .notNull()
      .default('organization'),
    aclRoles: text('acl_roles').array().notNull().default([]),
    aclUsers: uuid('acl_users').array().notNull().default([]),
    retentionDays: integer('retention_days'),
    activeIndexVersionId: uuid('active_index_version_id'),
    buildingIndexVersionId: uuid('building_index_version_id'),
    /** Remote collection identifier for API connections. */
    externalRef: text('external_ref'),
    status: text('status', { enum: ['active', 'paused', 'deleting'] })
      .notNull()
      .default('active'),
    /** Bumped when ACL/version changes; part of the retrieval cache key. */
    cacheEpoch: integer('cache_epoch').notNull().default(1),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('rag_collections_slug_uq').on(t.organizationId, t.slug)],
);

export const ragSources = pgTable(
  'rag_sources',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => ragCollections.id, { onDelete: 'cascade' }),
    /** upload | url | sitemap | internal | s3 */
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** Cron expression for scheduled sync (null = manual). */
    schedule: text('schedule'),
    status: text('status', { enum: ['active', 'paused', 'error', 'deleting'] })
      .notNull()
      .default('active'),
    lastSyncAt: ts('last_sync_at'),
    nextSyncAt: ts('next_sync_at'),
    lastError: text('last_error'),
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('rag_sources_collection_idx').on(t.collectionId)],
);

/** Domain view of durable jobs (pg-boss holds the queue; this table holds progress & cost). */
export const ragJobs = pgTable(
  'rag_jobs',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    collectionId: uuid('collection_id'),
    sourceId: uuid('source_id'),
    documentId: uuid('document_id'),
    kind: text('kind').notNull(),
    status: text('status', { enum: ['queued', 'running', 'retrying', 'paused', 'succeeded', 'failed', 'cancelled'] })
      .notNull()
      .default('queued'),
    stage: text('stage'),
    progressCurrent: integer('progress_current').notNull().default(0),
    /** null = unknown total (indeterminate progress) */
    progressTotal: integer('progress_total'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    bossJobId: text('boss_job_id'),
    idempotencyKey: text('idempotency_key').unique(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    units: jsonb('units').$type<Record<string, number>>().notNull().default({}),
    costUsd: money('cost_usd').notNull().default('0'),
    budgetUsd: money('budget_usd'),
    error: text('error'),
    cancelRequestedAt: ts('cancel_requested_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    stageTimings: jsonb('stage_timings').$type<Record<string, number>>().notNull().default({}),
    heartbeatAt: ts('heartbeat_at'),
  },
  (t) => [
    index('rag_jobs_org_status_idx').on(t.organizationId, t.status, t.createdAt),
    index('rag_jobs_source_idx').on(t.sourceId),
  ],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    jobId: uuid('job_id'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    discovered: integer('discovered').notNull().default(0),
    added: integer('added').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    removed: integer('removed').notNull().default(0),
    unchanged: integer('unchanged').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    status: text('status').notNull().default('running'),
  },
  (t) => [index('sync_runs_source_idx').on(t.sourceId, t.startedAt)],
);

export const retrievalRuns = pgTable(
  'retrieval_runs',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id'),
    agentId: uuid('agent_id'),
    conversationId: uuid('conversation_id'),
    aiRequestId: uuid('ai_request_id'),
    /** chat | playground | evaluation | api */
    origin: text('origin').notNull(),
    /** Query text is retained per retention policy and visible only with rag.analytics.read. */
    query: text('query'),
    method: text('method').notNull(),
    collectionIds: uuid('collection_ids').array().notNull(),
    topK: integer('top_k').notNull(),
    filters: jsonb('filters'),
    hitCount: integer('hit_count').notNull().default(0),
    usedInAnswer: boolean('used_in_answer').notNull().default(false),
    abstained: boolean('abstained').notNull().default(false),
    latencyMs: integer('latency_ms'),
    embeddingCostUsd: money('embedding_cost_usd'),
    answerCostUsd: money('answer_cost_usd'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('retrieval_runs_org_idx').on(t.organizationId, t.createdAt)],
);

export const retrievalHits = pgTable(
  'retrieval_hits',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => retrievalRuns.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    chunkId: text('chunk_id').notNull(),
    documentId: text('document_id'),
    collectionId: uuid('collection_id'),
    score: real('score'),
    /** cosine_similarity | ts_rank | rrf | external */
    scoreType: text('score_type').notNull(),
    cited: boolean('cited').notNull().default(false),
  },
  (t) => [index('retrieval_hits_run_idx').on(t.runId)],
);

export const evaluationSets = pgTable('evaluation_sets', {
  id: id(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  collectionIds: uuid('collection_ids').array().notNull(),
  cases: jsonb('cases')
    .$type<{ id: string; question: string; relevantDocumentIds: string[]; expectedAnswer?: string }[]>()
    .notNull()
    .default([]),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const evaluationResults = pgTable(
  'evaluation_results',
  {
    id: id(),
    setId: uuid('set_id')
      .notNull()
      .references(() => evaluationSets.id, { onDelete: 'cascade' }),
    runLabel: text('run_label').notNull(),
    caseId: text('case_id').notNull(),
    config: jsonb('config').notNull(),
    retrievedDocumentIds: text('retrieved_document_ids').array().notNull(),
    recallAtK: real('recall_at_k'),
    latencyMs: integer('latency_ms'),
    costUsd: money('cost_usd'),
    humanRating: integer('human_rating'),
    notes: text('notes'),
    ratedBy: uuid('rated_by'),
    createdAt: createdAt(),
  },
  (t) => [index('evaluation_results_set_idx').on(t.setId, t.runLabel)],
);

/** End-user feedback on assistant answers (used by the citations & feedback chart). */
export const answerFeedback = pgTable(
  'answer_feedback',
  {
    id: id(),
    organizationId: uuid('organization_id').notNull(),
    messageId: uuid('message_id').notNull(),
    agentId: uuid('agent_id'),
    userId: uuid('user_id').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('answer_feedback_uq').on(t.messageId, t.userId)],
);
