import { z } from 'zod';
import { IsoDate, PageQuery, pageOf, UsdAmount, Uuid } from './common.js';

export const ProviderKey = z.enum(['openai', 'anthropic', 'google', 'openai-compatible', 'test']).meta({ id: 'ProviderKey' });
export const CapabilityStatus = z.enum(['yes', 'no', 'unknown']).meta({ id: 'CapabilityStatus' });
export const ModelFunction = z.enum(['chat', 'embedding', 'transcription', 'speech', 'image', 'moderation', 'other']).meta({ id: 'ModelFunction' });
export const ErrorKind = z
  .enum(['auth', 'quota', 'network', 'model_not_found', 'invalid_request', 'content_filter', 'timeout', 'unknown'])
  .meta({ id: 'AiErrorKind' });

export const ProviderInfo = z
  .object({
    key: ProviderKey,
    label: z.string(),
    requiresBaseUrl: z.boolean(),
    requiresApiKey: z.boolean(),
    defaultBaseUrl: z.string().nullable(),
    supports: z.object({ chat: z.boolean(), embeddings: z.boolean(), transcription: z.boolean(), modelListing: z.boolean() }),
    available: z.boolean().meta({ description: 'false when disabled in this installation (e.g. test provider in production)' }),
  })
  .meta({ id: 'ProviderInfo' });

export const Connection = z
  .object({
    id: Uuid,
    provider: ProviderKey,
    alias: z.string(),
    baseUrl: z.string().nullable(),
    credentialSource: z.enum(['stored', 'reference', 'none']),
    credentialHint: z.string().nullable().meta({ description: 'Masked value (last 4) or the reference name; never the secret' }),
    status: z.enum(['unverified', 'ok', 'error', 'disabled']),
    lastErrorKind: ErrorKind.nullable(),
    lastError: z.string().nullable(),
    lastCheckedAt: IsoDate.nullable(),
    options: z.record(z.string(), z.unknown()),
    modelCount: z.number().int(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
  })
  .meta({ id: 'Connection' });
export type Connection = z.infer<typeof Connection>;

const Alias = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-_.]{1,62}$/i, 'letras, números, -, _ o .');
const SecretRefSchema = z.string().regex(/^(env|file):.+/, 'usa env:NOMBRE o file:/ruta');

export const CreateConnectionInput = z
  .object({
    provider: ProviderKey,
    alias: Alias,
    baseUrl: z.url().nullable().optional(),
    apiKey: z.string().min(1).max(4096).optional().meta({ description: 'Write-only. Stored encrypted (AES-256-GCM).', writeOnly: true }),
    credentialRef: SecretRefSchema.optional().meta({ description: 'Alternative to apiKey: deployment secret reference' }),
    options: z.record(z.string(), z.unknown()).default({}),
  })
  .meta({ id: 'CreateConnectionInput' });
export type CreateConnectionInput = z.infer<typeof CreateConnectionInput>;

export const UpdateConnectionInput = z
  .object({
    alias: Alias.optional(),
    baseUrl: z.url().nullable().optional(),
    apiKey: z.string().min(1).max(4096).optional().meta({ description: 'Rotates the stored credential', writeOnly: true }),
    credentialRef: SecretRefSchema.nullable().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    disabled: z.boolean().optional(),
  })
  .meta({ id: 'UpdateConnectionInput' });
export type UpdateConnectionInput = z.infer<typeof UpdateConnectionInput>;

export const ConnectionTestResult = z
  .object({
    ok: z.boolean(),
    errorKind: ErrorKind.nullable(),
    message: z.string(),
    latencyMs: z.number().int(),
    modelsVisible: z.number().int().nullable(),
  })
  .meta({ id: 'ConnectionTestResult' });

export const PriceRow = z
  .object({
    id: Uuid,
    provider: z.string(),
    modelId: z.string(),
    connectionId: Uuid.nullable(),
    billingScope: z.enum(['direct', 'gateway', 'custom', 'tier']),
    serviceTier: z.string().nullable(),
    unit: z.string(),
    unitQuantity: z.number().int(),
    price: UsdAmount,
    currency: z.string(),
    modality: z.string().nullable(),
    source: z.object({ kind: z.string(), name: z.string(), url: z.string().nullable() }),
    fetchedAt: IsoDate,
    effectiveFrom: IsoDate,
    effectiveTo: IsoDate.nullable(),
  })
  .meta({ id: 'PriceRow' });
export type PriceRow = z.infer<typeof PriceRow>;

export const CatalogModel = z
  .object({
    id: Uuid,
    connectionId: Uuid,
    connectionAlias: z.string(),
    provider: ProviderKey,
    modelId: z.string(),
    displayName: z.string().nullable(),
    family: z.string().nullable(),
    functions: z.array(z.string()),
    inputModalities: z.array(z.string()),
    outputModalities: z.array(z.string()),
    contextWindow: z.number().int().nullable(),
    maxOutputTokens: z.number().int().nullable(),
    embeddingDimensions: z.number().int().nullable(),
    capabilities: z.record(z.string(), CapabilityStatus),
    availability: z.enum(['available', 'unverified', 'unavailable', 'deprecated']),
    source: z.enum(['provider_api', 'catalog', 'manual']),
    sourceUrl: z.string().nullable(),
    lastVerifiedAt: IsoDate.nullable(),
    lastSyncedAt: IsoDate.nullable(),
    enabled: z.boolean(),
    prices: z.array(PriceRow),
  })
  .meta({ id: 'CatalogModel' });
export type CatalogModel = z.infer<typeof CatalogModel>;

export const ModelsQuery = PageQuery.extend({
  search: z.string().trim().max(100).optional(),
  function: ModelFunction.optional(),
  capability: z.string().max(40).optional(),
  connectionId: Uuid.optional(),
  availability: z.enum(['available', 'unverified', 'unavailable', 'deprecated']).optional(),
  sort: z.enum(['name', 'inputPrice', 'context']).default('name'),
});
export const ModelsPage = pageOf(CatalogModel, 'ModelsPage');

export const ManualModelInput = z
  .object({
    connectionId: Uuid,
    modelId: z.string().trim().min(1).max(200),
    displayName: z.string().max(200).optional(),
    functions: z.array(ModelFunction).min(1),
    inputModalities: z.array(z.string()).default(['text']),
    outputModalities: z.array(z.string()).default(['text']),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    embeddingDimensions: z.number().int().positive().optional(),
    capabilities: z.record(z.string(), CapabilityStatus).default({}),
    sourceUrl: z.url().meta({ description: 'Required evidence for manually imported data' }),
  })
  .meta({ id: 'ManualModelInput' });

export const UpdateModelInput = z
  .object({ enabled: z.boolean().optional(), capabilities: z.record(z.string(), CapabilityStatus).optional() })
  .meta({ id: 'UpdateModelInput' });

export const VerifyModelResult = z
  .object({
    availability: z.enum(['available', 'unavailable', 'unverified']),
    latencyMs: z.number().int(),
    errorKind: ErrorKind.nullable(),
    message: z.string(),
    costUsd: UsdAmount.nullable(),
  })
  .meta({ id: 'VerifyModelResult' });

export const SyncRun = z
  .object({
    id: Uuid,
    kind: z.enum(['prices', 'models']),
    status: z.enum(['running', 'succeeded', 'failed']),
    startedAt: IsoDate,
    finishedAt: IsoDate.nullable(),
    stats: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
  })
  .meta({ id: 'SyncRun' });

export const PricesQuery = PageQuery.extend({
  provider: z.string().max(40).optional(),
  modelId: z.string().max(200).optional(),
  includeHistory: z.coerce.boolean().default(false),
});
export const PricesPage = pageOf(PriceRow, 'PricesPage');

export const CreatePriceInput = z
  .object({
    provider: z.string().min(1).max(40),
    modelId: z.string().min(1).max(200),
    connectionId: Uuid.nullable().optional(),
    billingScope: z.enum(['direct', 'gateway', 'custom', 'tier']).default('custom'),
    serviceTier: z.string().max(40).nullable().optional(),
    unit: z.enum([
      'input_tokens',
      'output_tokens',
      'cached_input_tokens',
      'cache_write_tokens',
      'reasoning_tokens',
      'audio_input_tokens',
      'audio_seconds',
      'images',
      'requests',
      'embedding_tokens',
    ]),
    unitQuantity: z.number().int().positive().default(1_000_000),
    price: UsdAmount,
    sourceUrl: z.url().nullable().optional(),
    sourceName: z.string().max(120).default('Manual'),
    effectiveFrom: IsoDate.optional(),
  })
  .meta({ id: 'CreatePriceInput' });
export type CreatePriceInput = z.infer<typeof CreatePriceInput>;

export const UsageQuery = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  groupBy: z.enum(['provider', 'model', 'agent', 'user', 'feature', 'organization']).default('model'),
  feature: z.string().max(40).optional(),
});

export const UsageBreakdownRow = z.object({
  key: z.string(),
  label: z.string(),
  requests: z.number().int(),
  costUsd: UsdAmount,
  unknownCostRequests: z.number().int(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  errors: z.number().int(),
  avgLatencyMs: z.number().nullable(),
});

export const UsageDailyRow = z.object({
  date: z.string(),
  costUsd: UsdAmount,
  cumulativeUsd: UsdAmount,
  requests: z.number().int(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  errors: z.number().int(),
});

export const UsageSummary = z
  .object({
    from: IsoDate,
    to: IsoDate,
    totals: z.object({
      requests: z.number().int(),
      costUsd: UsdAmount,
      calculatedUsd: UsdAmount,
      estimatedUsd: UsdAmount,
      reconciledUsd: UsdAmount,
      unknownCostRequests: z.number().int(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      errors: z.number().int(),
      p50LatencyMs: z.number().nullable(),
      p95LatencyMs: z.number().nullable(),
    }),
    daily: z.array(UsageDailyRow),
    breakdown: z.array(UsageBreakdownRow),
    fx: z.object({ currency: z.literal('CLP'), rate: z.string(), rateDate: z.string(), source: z.string() }).nullable(),
  })
  .meta({ id: 'UsageSummary' });

export const AiRequestRow = z
  .object({
    id: Uuid,
    startedAt: IsoDate,
    feature: z.string(),
    provider: z.string().nullable(),
    modelId: z.string().nullable(),
    status: z.string(),
    usageStatus: z.string(),
    costStatus: z.string(),
    costUsd: UsdAmount.nullable(),
    estimatedCostUsd: UsdAmount.nullable(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    latencyMs: z.number().nullable(),
    attempts: z.number().int(),
    userEmail: z.string().nullable(),
    agentId: Uuid.nullable(),
    conversationId: Uuid.nullable(),
    errorKind: z.string().nullable(),
    requestId: z.string().nullable(),
  })
  .meta({ id: 'AiRequestRow' });
export const AiRequestsQuery = PageQuery.extend({
  feature: z.string().max(40).optional(),
  status: z.string().max(20).optional(),
  costStatus: z.string().max(20).optional(),
});
export const AiRequestsPage = pageOf(AiRequestRow, 'AiRequestsPage');

export const Budget = z
  .object({
    id: Uuid,
    name: z.string(),
    scopeType: z.enum(['organization', 'user', 'agent', 'feature']),
    scopeId: z.string().nullable(),
    period: z.enum(['day', 'month']),
    limitUsd: UsdAmount,
    alertThresholds: z.array(z.number().int()),
    hardLimit: z.boolean(),
    enabled: z.boolean(),
    current: z.object({ periodStart: z.string(), spentUsd: UsdAmount, reservedUsd: UsdAmount, percent: z.number() }),
    createdAt: IsoDate,
  })
  .meta({ id: 'Budget' });
export const BudgetList = z.array(Budget).meta({ id: 'BudgetList' });

export const BudgetInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    scopeType: z.enum(['organization', 'user', 'agent', 'feature']),
    scopeId: z.string().max(100).nullable().optional(),
    period: z.enum(['day', 'month']),
    limitUsd: UsdAmount,
    alertThresholds: z.array(z.number().int().min(1).max(100)).max(5).default([80, 100]),
    hardLimit: z.boolean().default(true),
    enabled: z.boolean().default(true),
  })
  .meta({ id: 'BudgetInput' });
export type BudgetInput = z.infer<typeof BudgetInput>;

export const RecommendationInput = z
  .object({
    useCase: z.string().trim().min(10).max(4000),
    requirements: z
      .object({
        function: ModelFunction.default('chat'),
        capabilities: z.array(z.string()).max(10).default([]),
        inputModalities: z.array(z.string()).max(5).default(['text']),
        minContext: z.number().int().positive().optional(),
        maxInputPricePerMillion: UsdAmount.optional(),
        maxOutputPricePerMillion: UsdAmount.optional(),
        onlyAvailable: z.boolean().default(true),
      })
      .prefault({}),
    evaluatorModelId: Uuid.optional().meta({ description: 'Catalog model used to compare the filtered candidates (optional)' }),
    budgetUsd: UsdAmount.default('0.05'),
    maxCandidates: z.number().int().min(1).max(20).default(8),
  })
  .meta({ id: 'RecommendationInput' });
export type RecommendationInput = z.infer<typeof RecommendationInput>;

export const RecommendationResult = z
  .object({
    method: z.enum(['deterministic', 'ai-assisted']),
    candidates: z.array(
      z.object({
        modelCatalogId: Uuid,
        modelId: z.string(),
        provider: z.string(),
        connectionAlias: z.string(),
        score: z.number(),
        reasons: z.array(z.string()),
        inputPricePerMillion: UsdAmount.nullable(),
        outputPricePerMillion: UsdAmount.nullable(),
      }),
    ),
    recommended: z.array(z.object({ modelCatalogId: Uuid, rank: z.number().int(), rationale: z.string() })),
    evaluator: z
      .object({ modelId: z.string(), costUsd: UsdAmount.nullable(), costStatus: z.string(), error: z.string().nullable() })
      .nullable(),
    excluded: z.number().int(),
  })
  .meta({ id: 'RecommendationResult' });

export const LabRunInput = z
  .object({
    prompts: z.array(z.string().trim().min(1).max(8000)).min(1).max(10),
    modelCatalogIds: z.array(Uuid).min(1).max(8),
    system: z.string().max(8000).optional(),
    maxOutputTokens: z.number().int().min(16).max(8000).default(400),
    budgetUsd: UsdAmount.default('0.50'),
    concurrency: z.number().int().min(1).max(4).default(2),
  })
  .meta({ id: 'LabRunInput' });
export type LabRunInput = z.infer<typeof LabRunInput>;

export const LabResult = z.object({
  modelCatalogId: Uuid,
  modelId: z.string(),
  promptIndex: z.number().int(),
  text: z.string().nullable(),
  error: z.string().nullable(),
  errorKind: z.string().nullable(),
  latencyMs: z.number().nullable(),
  timeToFirstTokenMs: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: UsdAmount.nullable(),
  costStatus: z.string(),
  skipped: z.boolean(),
});

export const LabRun = z
  .object({
    id: Uuid,
    kind: z.enum(['comparison', 'recommendation']),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
    input: z.unknown(),
    budgetUsd: UsdAmount.nullable(),
    spentUsd: UsdAmount.nullable(),
    results: z.array(LabResult).nullable(),
    error: z.string().nullable(),
    createdAt: IsoDate,
    finishedAt: IsoDate.nullable(),
  })
  .meta({ id: 'LabRun' });
export const LabRunList = z.array(LabRun).meta({ id: 'LabRunList' });
