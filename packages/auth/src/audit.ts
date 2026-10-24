import { auditEvents, type DbOrTx } from '@starter/db';
import { createLogger, currentContext } from '@starter/observability';
import type { Actor } from './actor.js';

const log = createLogger('audit');

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: 'success' | 'denied' | 'failed' | 'cancelled';
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  organizationId?: string | null;
  proposalId?: string | null;
}

/** Keys never persisted in audit snapshots. */
const SECRET_KEYS = /(password|secret|token|apikey|api_key|credential|otp|ciphertext)/i;

export function redactForAudit(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactForAudit(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redactForAudit(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

/** Masks an e-mail for audit snapshots of deleted users (a***@domain). */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function recordAudit(db: DbOrTx, actor: Actor | null, entry: AuditEntry): Promise<void> {
  const viaAgent = actor?.channel === 'chat' && actor.agent;
  try {
    await db.insert(auditEvents).values({
      actorType: !actor ? 'system' : viaAgent ? 'agent' : actor.channel === 'cli' ? 'cli' : actor.channel === 'system' ? 'system' : 'user',
      actorUserId: actor && actor.channel !== 'system' ? actor.userId : null,
      agentId: actor?.agent?.agentId ?? null,
      conversationId: actor?.agent?.conversationId ?? null,
      toolCallId: actor?.agent?.toolCallId ?? null,
      proposalId: entry.proposalId ?? null,
      requestId: actor?.requestId ?? currentContext()?.requestId ?? null,
      organizationId: entry.organizationId === undefined ? (actor?.organizationId ?? null) : entry.organizationId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      outcome: entry.outcome,
      before: entry.before === undefined ? null : redactForAudit(entry.before),
      after: entry.after === undefined ? null : redactForAudit(entry.after),
      metadata: entry.metadata ? redactForAudit(entry.metadata) : null,
      ip: actor?.ip ?? null,
      userAgent: actor?.userAgent?.slice(0, 300) ?? null,
    });
  } catch (err) {
    // Audit failures must be visible; callers inside a transaction will roll back.
    log.error({ action: entry.action, err: (err as Error).message }, 'audit write failed');
    throw err;
  }
}
