import { and, auditEvents, count, desc, eq, gte, ilike, isNull, likeTerm, lte, normalizePage, offsetOf, or, toPage, users, type SQL } from '@starter/db';
import { assertCan, type AccessDeps, type Actor } from './actor.js';

export interface AuditListQuery {
  page?: number;
  pageSize?: number;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  actorUserId?: string;
  outcome?: 'success' | 'denied' | 'failed' | 'cancelled';
  from?: string;
  to?: string;
}

export class AuditQueryService {
  constructor(private readonly deps: AccessDeps) {}

  private scope(actor: Actor): SQL | undefined {
    // Platform auditors see installation-level events as well as the active organization.
    return actor.platformPermissions.has('audit.read')
      ? or(eq(auditEvents.organizationId, actor.organizationId), isNull(auditEvents.organizationId))
      : eq(auditEvents.organizationId, actor.organizationId);
  }

  async list(actor: Actor, q: AuditListQuery) {
    assertCan(actor, 'audit.read');
    const params = normalizePage(q);
    const where = and(
      this.scope(actor),
      q.action ? ilike(auditEvents.action, likeTerm(q.action)) : undefined,
      q.resourceType ? eq(auditEvents.resourceType, q.resourceType) : undefined,
      q.resourceId ? eq(auditEvents.resourceId, q.resourceId) : undefined,
      q.actorUserId ? eq(auditEvents.actorUserId, q.actorUserId) : undefined,
      q.outcome ? eq(auditEvents.outcome, q.outcome) : undefined,
      q.from ? gte(auditEvents.occurredAt, new Date(q.from)) : undefined,
      q.to ? lte(auditEvents.occurredAt, new Date(q.to)) : undefined,
    );
    const [rows, total] = await Promise.all([
      this.deps.db
        .select({ e: auditEvents, email: users.email })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(where)
        .orderBy(desc(auditEvents.occurredAt))
        .limit(params.pageSize)
        .offset(offsetOf(params)),
      this.deps.db.select({ n: count() }).from(auditEvents).where(where),
    ]);
    return toPage(
      rows.map(({ e, email }) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        actorType: e.actorType,
        actorUserId: e.actorUserId,
        actorEmail: email ?? null,
        agentId: e.agentId,
        conversationId: e.conversationId,
        proposalId: e.proposalId,
        requestId: e.requestId,
        organizationId: e.organizationId,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        outcome: e.outcome,
        before: e.before ?? null,
        after: e.after ?? null,
        metadata: e.metadata ?? null,
      })),
      total[0]?.n ?? 0,
      params,
    );
  }
}
