import { z } from 'zod';
import { IsoDate, PageQuery, pageOf, Uuid } from './common.js';

export const BrandingSettings = z
  .object({
    appName: z.string().trim().min(1).max(80),
    logoUrl: z.url().nullable(),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#2563eb'),
    supportEmail: z.email().nullable(),
  })
  .meta({ id: 'BrandingSettings' });

export const LocaleSettings = z
  .object({
    locale: z.string().min(2).max(20),
    timezone: z.string().min(1).max(60),
    currencyDisplay: z.enum(['USD', 'CLP']).default('USD'),
  })
  .meta({ id: 'LocaleSettings' });

export const AuthSettings = z
  .object({
    registration: z.enum(['open', 'invite-only', 'disabled']),
    sessionExpiresDays: z.number().int().min(1).max(365),
  })
  .meta({ id: 'AuthSettings' });

export const MailSettings = z
  .object({
    transport: z.enum(['smtp', 'resend', 'log']).meta({ description: 'Configured through deployment environment' }),
    from: z.string(),
    configured: z.boolean(),
  })
  .meta({ id: 'MailSettings' });

export const RetentionSettings = z
  .object({
    conversationsDays: z.number().int().min(1).max(3650).nullable(),
    retrievalQueriesDays: z.number().int().min(1).max(3650).nullable(),
    audioKeepAfterTranscription: z.boolean(),
    auditDays: z.number().int().min(30).max(3650).nullable(),
  })
  .meta({ id: 'RetentionSettings' });

export const AppSettings = z
  .object({
    branding: BrandingSettings,
    locale: LocaleSettings,
    auth: AuthSettings,
    mail: MailSettings,
    retention: RetentionSettings,
    onboardingCompletedAt: IsoDate.nullable(),
  })
  .meta({ id: 'AppSettings' });
export type AppSettings = z.infer<typeof AppSettings>;

export const UpdateSettingsInput = z
  .object({
    branding: BrandingSettings.partial().optional(),
    locale: LocaleSettings.partial().optional(),
    auth: AuthSettings.partial().optional(),
    retention: RetentionSettings.partial().optional(),
  })
  .meta({ id: 'UpdateSettingsInput' });
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInput>;

export const PublicSettings = z
  .object({
    appName: z.string(),
    logoUrl: z.string().nullable(),
    primaryColor: z.string(),
    locale: z.string(),
    timeZone: z.string(),
    registration: z.enum(['open', 'invite-only', 'disabled']),
    otpLength: z.number().int(),
    otpResendSeconds: z.number().int(),
  })
  .meta({ id: 'PublicSettings' });

export const AuditEvent = z
  .object({
    id: Uuid,
    occurredAt: IsoDate,
    actorType: z.enum(['user', 'agent', 'system', 'cli']),
    actorUserId: Uuid.nullable(),
    actorEmail: z.string().nullable(),
    agentId: Uuid.nullable(),
    conversationId: Uuid.nullable(),
    proposalId: Uuid.nullable(),
    requestId: z.string().nullable(),
    organizationId: Uuid.nullable(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    outcome: z.enum(['success', 'denied', 'failed', 'cancelled']),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    metadata: z.unknown().nullable(),
  })
  .meta({ id: 'AuditEvent' });

export const AuditQuery = PageQuery.extend({
  action: z.string().max(100).optional(),
  resourceType: z.string().max(60).optional(),
  resourceId: z.string().max(100).optional(),
  actorUserId: Uuid.optional(),
  outcome: z.enum(['success', 'denied', 'failed', 'cancelled']).optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});

export const AuditPage = pageOf(AuditEvent, 'AuditPage');

export const ProposalChange = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});

export const ActionProposal = z
  .object({
    id: Uuid,
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    status: z.enum(['pending', 'executing', 'executed', 'cancelled', 'expired', 'failed']),
    title: z.string(),
    target: z.object({ label: z.string(), href: z.string().nullable() }),
    changes: z.array(ProposalChange),
    effects: z.array(z.string()),
    expiresAt: IsoDate,
    createdAt: IsoDate,
    result: z.unknown().nullable(),
    error: z.string().nullable(),
  })
  .meta({ id: 'ActionProposal' });
export type ActionProposal = z.infer<typeof ActionProposal>;

export const ConfirmProposalResult = z
  .object({ proposal: ActionProposal, href: z.string().nullable() })
  .meta({ id: 'ConfirmProposalResult' });

export const HealthStatus = z
  .object({
    status: z.enum(['ok', 'degraded', 'error']),
    checks: z.record(
      z.string(),
      z.object({ status: z.enum(['ok', 'degraded', 'error', 'disabled']), detail: z.string().optional(), latencyMs: z.number().optional() }),
    ),
    version: z.string(),
    uptimeSeconds: z.number(),
  })
  .meta({ id: 'HealthStatus' });

export const DependencyVersion = z
  .object({
    name: z.string(),
    installed: z.string(),
    latest: z.string().nullable(),
    checkedAt: IsoDate.nullable(),
    updateAvailable: z.boolean().nullable(),
    support: z.string().nullable(),
  })
  .meta({ id: 'DependencyVersion' });

export const Diagnostics = z
  .object({
    starterVersion: z.string(),
    node: z.object({ version: z.string(), lts: z.string().nullable(), supported: z.boolean() }),
    database: z.object({ version: z.string(), pgvector: z.string().nullable(), migrations: z.number().int() }),
    jobs: z.object({ queued: z.number().int(), active: z.number().int(), failed24h: z.number().int(), workerSeenAt: IsoDate.nullable() }),
    dependencies: z.array(DependencyVersion),
    features: z.object({ organizations: z.boolean(), ai: z.boolean(), rag: z.boolean() }),
    mail: z.object({ transport: z.string(), ok: z.boolean(), detail: z.string().nullable() }),
    storage: z.object({ driver: z.string(), ok: z.boolean(), detail: z.string().nullable() }),
  })
  .meta({ id: 'Diagnostics' });

export const DashboardSummary = z
  .object({
    users: z.object({ total: z.number().int(), active: z.number().int(), disabled: z.number().int(), pendingInvitations: z.number().int() }),
    ai: z.object({
      configured: z.boolean(),
      connections: z.number().int(),
      agentsPublished: z.number().int(),
      requests7d: z.number().int(),
      cost7dUsd: z.string(),
      unknownCostRequests7d: z.number().int(),
    }),
    rag: z.object({ enabled: z.boolean(), collections: z.number().int(), documents: z.number().int(), runningJobs: z.number().int() }),
    recentAudit: z.array(AuditEvent),
    health: HealthStatus,
  })
  .meta({ id: 'DashboardSummary' });
