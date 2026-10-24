import { Inject, Injectable } from '@nestjs/common';
import { AuditQueryService, can, type Actor } from '@starter/auth';
import type { FeatureFlags } from '@starter/config';
import { and, count, eq, gt, invitations, isNotNull, isNull, sql, users, type DbHandle } from '@starter/db';
import type { DashboardSummary } from '@starter/contracts';
import type { z } from 'zod';
import { DB, FEATURES } from '../../infra/tokens.js';
import { HealthService } from '../health/health.service.js';

type Summary = z.infer<typeof DashboardSummary>;

export type DashboardContributor = (actor: Actor) => Promise<Partial<Pick<Summary, 'ai' | 'rag'>>>;

@Injectable()
export class DashboardService {
  private readonly contributors: DashboardContributor[] = [];

  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(FEATURES) private readonly features: FeatureFlags,
    private readonly health: HealthService,
    private readonly audit: AuditQueryService,
  ) {}

  /** AI and RAG modules contribute their own aggregates (only when enabled). */
  register(c: DashboardContributor): void {
    this.contributors.push(c);
  }

  async summary(actor: Actor): Promise<Summary> {
    const db = this.db.db;
    let usersStats: Summary['users'] = { total: 0, active: 0, disabled: 0, pendingInvitations: 0 };
    if (can(actor, 'users.read')) {
      const [[total], [disabled], [pending], [inv]] = await Promise.all([
        db.select({ n: count() }).from(users),
        db.select({ n: count() }).from(users).where(isNotNull(users.disabledAt)),
        db.select({ n: count() }).from(users).where(and(isNull(users.disabledAt), eq(users.emailVerified, false), isNull(users.lastLoginAt))),
        db.select({ n: count() }).from(invitations).where(and(eq(invitations.status, 'pending'), gt(invitations.expiresAt, sql`now()`))),
      ]);
      usersStats = {
        total: total?.n ?? 0,
        disabled: disabled?.n ?? 0,
        active: (total?.n ?? 0) - (disabled?.n ?? 0) - (pending?.n ?? 0),
        pendingInvitations: inv?.n ?? 0,
      };
    }
    const base: Summary = {
      users: usersStats,
      ai: { configured: false, connections: 0, agentsPublished: 0, requests7d: 0, cost7dUsd: '0', unknownCostRequests7d: 0 },
      rag: { enabled: false, collections: 0, documents: 0, runningJobs: 0 },
      recentAudit: can(actor, 'audit.read') ? (await this.audit.list(actor, { page: 1, pageSize: 8 })).items : [],
      health: await this.health.readiness(),
    };
    for (const c of this.contributors) Object.assign(base, await c(actor));
    if (!this.features.ai) base.ai.configured = false;
    return base;
  }
}
