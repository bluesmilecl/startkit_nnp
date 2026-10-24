import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, ts, updatedAt } from './_helpers.js';
import { organizations } from './access.js';

export type CapabilityStatus = 'yes' | 'no' | 'unknown';

export const providerConnections = pgTable(
  'provider_connections',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Adapter key: openai | anthropic | google | openai-compatible | test */
    provider: text('provider').notNull(),
    alias: text('alias').notNull(),
    /** Optional custom endpoint (validated against the allow policy). */
    baseUrl: text('base_url'),
    /** Either an encrypted credential (enc:v1:...) or a deployment reference (env:NAME / file:/path). */
    credentialCiphertext: text('credential_ciphertext'),
    credentialRef: text('credential_ref'),
    credentialHint: text('credential_hint'),
    status: text('status', { enum: ['unverified', 'ok', 'error', 'disabled'] })
      .notNull()
      .default('unverified'),
    lastErrorKind: text('last_error_kind'),
    lastError: text('last_error'),
    lastCheckedAt: ts('last_checked_at'),
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('provider_connections_alias_uq').on(t.organizationId, t.alias)],
);

export const modelCatalog = pgTable(
  'model_catalog',
  {
    id: id(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    /** Exact identifier sent to the provider. */
    modelId: text('model_id').notNull(),
    displayName: text('display_name'),
    family: text('family'),
    version: text('version'),
    /** chat | embedding | transcription | speech | image | moderation | other */
    functions: text('functions').array().notNull().default(sql`'{}'::text[]`),
    inputModalities: text('input_modalities').array().notNull().default(sql`'{}'::text[]`),
    outputModalities: text('output_modalities').array().notNull().default(sql`'{}'::text[]`),
    contextWindow: integer('context_window'),
    maxOutputTokens: integer('max_output_tokens'),
    embeddingDimensions: integer('embedding_dimensions'),
    /** provider_api | catalog | manual */
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    /** available | unverified | unavailable | deprecated */
    availability: text('availability').notNull().default('unverified'),
    lastVerifiedAt: ts('last_verified_at'),
    lastSyncedAt: ts('last_synced_at'),
    raw: jsonb('raw'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('model_catalog_conn_model_uq').on(t.connectionId, t.modelId)],
);

export const modelCapabilities = pgTable(
  'model_capabilities',
  {
    modelCatalogId: uuid('model_catalog_id')
      .notNull()
      .references(() => modelCatalog.id, { onDelete: 'cascade' }),
    /** tools | structured_output | streaming | temperature | reasoning | attachments_image | attachments_pdf | ... */
    capability: text('capability').notNull(),
    status: text('status').$type<CapabilityStatus>().notNull().default('unknown'),
    source: text('source').notNull(),
    verifiedAt: ts('verified_at'),
    notes: text('notes'),
  },
  (t) => [primaryKey({ columns: [t.modelCatalogId, t.capability] })],
);

export const priceSources = pgTable('price_sources', {
  id: id(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  /** catalog | manual | provider | agreement */
  kind: text('kind').notNull(),
  url: text('url'),
  lastFetchedAt: ts('last_fetched_at'),
  createdAt: createdAt(),
});

/**
 * Tariffs. A price row is immutable once used: changes create a new row with a new validity window
 * so historical estimates keep the snapshot they were calculated with.
 */
export const modelPrices = pgTable(
  'model_prices',
  {
    id: id(),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    /** NULL = applies to every connection of the provider; otherwise a specific billing connection. */
    connectionId: uuid('connection_id').references(() => providerConnections.id, { onDelete: 'cascade' }),
    /** direct | gateway | custom | tier */
    billingScope: text('billing_scope').notNull().default('direct'),
    serviceTier: text('service_tier'),
    /** input_tokens | output_tokens | cached_input_tokens | cache_write_tokens | reasoning_tokens | audio_input_tokens | audio_seconds | images | requests | embedding_tokens */
    unit: text('unit').notNull(),
    /** Price for `unitQuantity` units (e.g. 1,000,000 tokens). */
    unitQuantity: bigint('unit_quantity', { mode: 'number' }).notNull().default(1_000_000),
    price: money('price').notNull(),
    currency: text('currency').notNull().default('USD'),
    modality: text('modality'),
    sourceId: uuid('source_id').references(() => priceSources.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url'),
    fetchedAt: ts('fetched_at').notNull(),
    effectiveFrom: ts('effective_from').notNull(),
    effectiveTo: ts('effective_to'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('model_prices_lookup_idx').on(t.provider, t.modelId, t.unit, t.effectiveFrom)],
);

export const priceSyncRuns = pgTable('price_sync_runs', {
  id: id(),
  sourceId: uuid('source_id').references(() => priceSources.id, { onDelete: 'set null' }),
  kind: text('kind', { enum: ['prices', 'models'] }).notNull(),
  status: text('status', { enum: ['running', 'succeeded', 'failed'] }).notNull(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  stats: jsonb('stats'),
  error: text('error'),
  triggeredBy: uuid('triggered_by'),
});

/** One logical AI execution (a chat turn, a recommendation, an embedding batch, ...). */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: id(),
    requestId: text('request_id'),
    idempotencyKey: text('idempotency_key').unique(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id'),
    agentId: uuid('agent_id'),
    agentVersionId: uuid('agent_version_id'),
    conversationId: uuid('conversation_id'),
    jobId: text('job_id'),
    /** chat | recommendation | lab | embedding | rag_query | transcription | tool | connection_test | evaluation */
    feature: text('feature').notNull(),
    provider: text('provider'),
    connectionId: uuid('connection_id'),
    modelId: text('model_id'),
    status: text('status', { enum: ['running', 'succeeded', 'failed', 'cancelled'] })
      .notNull()
      .default('running'),
    /** known | pending | unknown */
    usageStatus: text('usage_status').notNull().default('pending'),
    /** calculated | estimated | unknown | reconciled */
    costStatus: text('cost_status').notNull().default('estimated'),
    startedAt: ts('started_at').notNull().defaultNow(),
    firstTokenAt: ts('first_token_at'),
    finishedAt: ts('finished_at'),
    latencyMs: integer('latency_ms'),
    inputTokens: bigint('input_tokens', { mode: 'number' }),
    outputTokens: bigint('output_tokens', { mode: 'number' }),
    cachedInputTokens: bigint('cached_input_tokens', { mode: 'number' }),
    reasoningTokens: bigint('reasoning_tokens', { mode: 'number' }),
    otherUnits: jsonb('other_units').$type<Record<string, number>>(),
    estimatedCostUsd: money('estimated_cost_usd'),
    costUsd: money('cost_usd'),
    reconciledCostUsd: money('reconciled_cost_usd'),
    errorKind: text('error_kind'),
    error: text('error'),
    metadata: jsonb('metadata'),
  },
  (t) => [
    index('ai_requests_org_started_idx').on(t.organizationId, t.startedAt),
    index('ai_requests_feature_idx').on(t.feature, t.startedAt),
    index('ai_requests_conversation_idx').on(t.conversationId),
  ],
);

/** Each real provider call (retries and fallbacks are separate attempts). */
export const aiAttempts = pgTable(
  'ai_attempts',
  {
    id: id(),
    aiRequestId: uuid('ai_request_id')
      .notNull()
      .references(() => aiRequests.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    provider: text('provider').notNull(),
    connectionId: uuid('connection_id'),
    modelId: text('model_id').notNull(),
    status: text('status', { enum: ['running', 'succeeded', 'failed', 'cancelled'] }).notNull(),
    billable: boolean('billable').notNull().default(true),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    units: jsonb('units').$type<Record<string, number>>(),
    usageStatus: text('usage_status').notNull().default('pending'),
    costUsd: money('cost_usd'),
    costStatus: text('cost_status').notNull().default('unknown'),
    errorKind: text('error_kind'),
    error: text('error'),
  },
  (t) => [uniqueIndex('ai_attempts_req_no_uq').on(t.aiRequestId, t.attemptNo)],
);

/** Exact copy of the tariffs used for an estimate; history never recalculates silently. */
export const costSnapshots = pgTable('cost_snapshots', {
  id: id(),
  prices: jsonb('prices').notNull(),
  createdAt: createdAt(),
});

/** Ledger: one row per unit type consumed by an attempt. */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    aiRequestId: uuid('ai_request_id')
      .notNull()
      .references(() => aiRequests.id, { onDelete: 'cascade' }),
    aiAttemptId: uuid('ai_attempt_id').references(() => aiAttempts.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').notNull(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    unit: text('unit').notNull(),
    quantity: bigint('quantity', { mode: 'number' }).notNull(),
    costUsd: money('cost_usd'),
    /** calculated | unknown */
    costStatus: text('cost_status').notNull(),
    priceId: uuid('price_id'),
    snapshotId: uuid('snapshot_id').references(() => costSnapshots.id),
    idempotencyKey: text('idempotency_key').unique(),
  },
  (t) => [index('usage_events_org_time_idx').on(t.organizationId, t.occurredAt)],
);

export const budgets = pgTable('budgets', {
  id: id(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** organization | user | agent | feature */
  scopeType: text('scope_type').notNull(),
  scopeId: text('scope_id'),
  period: text('period', { enum: ['day', 'month'] }).notNull(),
  limitUsd: money('limit_usd').notNull(),
  /** Percentages that trigger alerts, e.g. {50,80,100}. */
  alertThresholds: integer('alert_thresholds').array().notNull().default(sql`'{80,100}'::integer[]`),
  /** When true, requests are blocked once the limit would be exceeded. */
  hardLimit: boolean('hard_limit').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const budgetUsage = pgTable(
  'budget_usage',
  {
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    spentUsd: money('spent_usd').notNull().default('0'),
    reservedUsd: money('reserved_usd').notNull().default('0'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.budgetId, t.periodStart] })],
);

export const reservations = pgTable(
  'reservations',
  {
    id: id(),
    aiRequestId: uuid('ai_request_id'),
    budgetIds: uuid('budget_ids').array().notNull(),
    periodStarts: text('period_starts').array().notNull(),
    amountUsd: money('amount_usd').notNull(),
    settledUsd: money('settled_usd'),
    status: text('status', { enum: ['reserved', 'settled', 'released'] })
      .notNull()
      .default('reserved'),
    createdAt: createdAt(),
    settledAt: ts('settled_at'),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('reservations_status_idx').on(t.status, t.expiresAt)],
);

export const budgetAlerts = pgTable(
  'budget_alerts',
  {
    id: id(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    threshold: integer('threshold').notNull(),
    spentUsd: money('spent_usd').notNull(),
    triggeredAt: ts('triggered_at').notNull().defaultNow(),
    notifiedAt: ts('notified_at'),
  },
  (t) => [uniqueIndex('budget_alerts_uq').on(t.budgetId, t.periodStart, t.threshold)],
);

/** Exchange rates used only for display (never mixed with recorded USD amounts). */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: id(),
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: money('rate').notNull(),
    rateDate: date('rate_date', { mode: 'string' }).notNull(),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fx_rates_uq').on(t.base, t.quote, t.rateDate, t.source)],
);

/** Model lab / comparison runs. */
export const labRuns = pgTable('lab_runs', {
  id: id(),
  organizationId: uuid('organization_id').notNull(),
  createdBy: uuid('created_by').notNull(),
  kind: text('kind', { enum: ['comparison', 'recommendation'] }).notNull(),
  input: jsonb('input').notNull(),
  status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] }).notNull(),
  budgetUsd: money('budget_usd'),
  spentUsd: money('spent_usd'),
  results: jsonb('results'),
  error: text('error'),
  createdAt: createdAt(),
  finishedAt: ts('finished_at'),
});
