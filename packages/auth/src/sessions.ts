import { AppError } from '@starter/contracts';
import { and, desc, eq, ne, sessions, sql } from '@starter/db';
import type { AccessDeps, Actor } from './actor.js';
import { recordAudit } from './audit.js';

/** Self-service session management (own sessions only). */
export class SessionsService {
  constructor(private readonly deps: AccessDeps) {}

  async listOwn(actor: Actor) {
    const rows = await this.deps.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, actor.userId), sql`${sessions.expiresAt} > now()`))
      .orderBy(desc(sessions.createdAt));
    return rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      current: s.id === actor.sessionId,
    }));
  }

  async revokeOwn(actor: Actor, sessionId: string): Promise<void> {
    const deleted = await this.deps.db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, actor.userId)))
      .returning({ id: sessions.id });
    if (!deleted.length) throw AppError.notFound('Sesión');
    await recordAudit(this.deps.db, actor, { action: 'sessions.revoke', resourceType: 'session', resourceId: sessionId, outcome: 'success' });
  }

  async revokeOtherOwn(actor: Actor): Promise<{ revoked: number }> {
    const where = actor.sessionId
      ? and(eq(sessions.userId, actor.userId), ne(sessions.id, actor.sessionId))
      : eq(sessions.userId, actor.userId);
    const deleted = await this.deps.db.delete(sessions).where(where).returning({ id: sessions.id });
    await recordAudit(this.deps.db, actor, {
      action: 'sessions.revokeOthers',
      resourceType: 'session',
      resourceId: actor.userId,
      outcome: 'success',
      metadata: { revoked: deleted.length },
    });
    return { revoked: deleted.length };
  }
}
