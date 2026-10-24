import { sha256 } from '@starter/config';
import { AppError, isAppError, type ActionProposal } from '@starter/contracts';
import { actionProposals, and, eq, lt, sql, type DbOrTx } from '@starter/db';
import { sanitizeError } from '@starter/observability';
import type { AccessDeps, Actor } from './actor.js';
import { recordAudit } from './audit.js';

export interface ProposalPreview {
  resourceType: string;
  resourceId: string | null;
  resourceVersion: string | null;
  title: string;
  target: { label: string; href: string | null };
  changes: { field: string; before: unknown; after: unknown }[];
  effects: string[];
  /** Normalized arguments: the only values the executor will use. */
  args: Record<string, unknown>;
}

export interface ProposalExecutor {
  action: string;
  /** Dry run with the same authorization checks as the execution. */
  preview(actor: Actor, args: unknown): Promise<ProposalPreview>;
  /** Current version of the target; must still equal the previewed version. */
  currentVersion(actor: Actor, args: Record<string, unknown>): Promise<string | null>;
  execute(actor: Actor, args: Record<string, unknown>): Promise<{ result: unknown; href: string | null }>;
}

export interface ProposalSource {
  source: 'chat' | 'panel' | 'api' | 'cli';
  agentId?: string | null;
  conversationId?: string | null;
  toolCallId?: string | null;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function proposalHash(action: string, resourceId: string | null, version: string | null, args: unknown): string {
  return sha256(canonical({ action, resourceId, version, args }));
}

type Row = typeof actionProposals.$inferSelect;

/**
 * Preview → confirm → execute flow for sensitive operations. Confirmation is bound to the
 * stored proposal (actor, normalized args, target version, expiry, single use); a generic
 * model message can never authorize a different change.
 */
export class ProposalsService {
  private readonly executors = new Map<string, ProposalExecutor>();

  constructor(
    private readonly deps: AccessDeps,
    executors: ProposalExecutor[] = [],
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {
    for (const e of executors) this.register(e);
  }

  register(executor: ProposalExecutor): void {
    this.executors.set(executor.action, executor);
  }

  has(action: string): boolean {
    return this.executors.has(action);
  }

  private executor(action: string): ProposalExecutor {
    const e = this.executors.get(action);
    if (!e) throw AppError.validation(`Acción no soportada: ${action}`);
    return e;
  }

  static toDto(row: Row): ActionProposal {
    const preview = row.preview as Pick<ProposalPreview, 'title' | 'target' | 'changes' | 'effects'>;
    const expired = row.status === 'pending' && row.expiresAt < new Date();
    return {
      id: row.id,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      status: expired ? 'expired' : row.status,
      title: preview.title,
      target: preview.target,
      changes: preview.changes,
      effects: preview.effects,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      result: (row.result as unknown) ?? null,
      error: row.error,
    };
  }

  async propose(actor: Actor, action: string, rawArgs: unknown, source: ProposalSource): Promise<ActionProposal> {
    const executor = this.executor(action);
    let preview: ProposalPreview;
    try {
      preview = await executor.preview(actor, rawArgs);
    } catch (err) {
      if (isAppError(err) && err.code === 'FORBIDDEN') {
        await recordAudit(this.deps.db, actor, {
          action,
          resourceType: 'proposal',
          outcome: 'denied',
          metadata: { stage: 'preview', reason: err.message, source: source.source },
        });
      }
      throw err;
    }
    const [row] = await this.deps.db
      .insert(actionProposals)
      .values({
        actorUserId: actor.userId,
        organizationId: actor.organizationId,
        action,
        resourceType: preview.resourceType,
        resourceId: preview.resourceId,
        resourceVersion: preview.resourceVersion,
        args: preview.args,
        argsHash: proposalHash(action, preview.resourceId, preview.resourceVersion, preview.args),
        preview: { title: preview.title, target: preview.target, changes: preview.changes, effects: preview.effects },
        source: source.source,
        agentId: source.agentId ?? null,
        conversationId: source.conversationId ?? null,
        toolCallId: source.toolCallId ?? null,
        expiresAt: new Date(Date.now() + this.ttlMs),
      })
      .returning();
    return ProposalsService.toDto(row!);
  }

  async get(actor: Actor, id: string): Promise<ActionProposal> {
    const [row] = await this.deps.db
      .select()
      .from(actionProposals)
      .where(and(eq(actionProposals.id, id), eq(actionProposals.actorUserId, actor.userId)))
      .limit(1);
    if (!row) throw AppError.notFound('Propuesta');
    return ProposalsService.toDto(row);
  }

  async confirm(actor: Actor, id: string): Promise<{ proposal: ActionProposal; href: string | null; replayed: boolean }> {
    const db = this.deps.db;
    const [claimed] = await db
      .update(actionProposals)
      .set({ status: 'executing', decidedAt: new Date() })
      .where(
        and(
          eq(actionProposals.id, id),
          eq(actionProposals.actorUserId, actor.userId),
          eq(actionProposals.status, 'pending'),
          sql`${actionProposals.expiresAt} > now()`,
        ),
      )
      .returning();

    if (!claimed) {
      const [row] = await db
        .select()
        .from(actionProposals)
        .where(and(eq(actionProposals.id, id), eq(actionProposals.actorUserId, actor.userId)))
        .limit(1);
      if (!row) throw AppError.notFound('Propuesta');
      if (row.status === 'executed') {
        // Idempotent replay: the change already happened exactly once.
        const r = row.result as { href?: string | null } | null;
        return { proposal: ProposalsService.toDto(row), href: r?.href ?? null, replayed: true };
      }
      if (row.status === 'pending' && row.expiresAt <= new Date()) {
        await db.update(actionProposals).set({ status: 'expired' }).where(eq(actionProposals.id, id));
        await this.audit(db, actor, row, 'cancelled', { reason: 'expired' });
        throw new AppError('GONE', 'La propuesta venció; solicita el cambio nuevamente');
      }
      if (row.status === 'executing') throw AppError.conflict('La propuesta se está ejecutando');
      throw AppError.conflict(`La propuesta ya fue ${row.status === 'cancelled' ? 'cancelada' : 'procesada'}`);
    }

    const executor = this.executor(claimed.action);
    const args = claimed.args as Record<string, unknown>;
    try {
      if (proposalHash(claimed.action, claimed.resourceId, claimed.resourceVersion, args) !== claimed.argsHash) {
        throw AppError.precondition('La propuesta fue alterada');
      }
      const current = await executor.currentVersion(actor, args);
      if (current !== claimed.resourceVersion) {
        throw AppError.precondition('El recurso cambió desde la vista previa; solicita el cambio nuevamente');
      }
      const { result, href } = await executor.execute(actor, args);
      const [done] = await db
        .update(actionProposals)
        .set({ status: 'executed', result: { value: result ?? null, href } })
        .where(eq(actionProposals.id, id))
        .returning();
      await this.audit(db, actor, claimed, 'success', { href });
      return { proposal: ProposalsService.toDto(done!), href, replayed: false };
    } catch (err) {
      const message = isAppError(err) ? err.message : sanitizeError(err);
      await db.update(actionProposals).set({ status: 'failed', error: message }).where(eq(actionProposals.id, id));
      await this.audit(db, actor, claimed, isAppError(err) && err.code === 'FORBIDDEN' ? 'denied' : 'failed', { error: message });
      throw err;
    }
  }

  async cancel(actor: Actor, id: string): Promise<ActionProposal> {
    const [row] = await this.deps.db
      .update(actionProposals)
      .set({ status: 'cancelled', decidedAt: new Date() })
      .where(and(eq(actionProposals.id, id), eq(actionProposals.actorUserId, actor.userId), eq(actionProposals.status, 'pending')))
      .returning();
    if (!row) {
      const existing = await this.get(actor, id);
      if (existing.status === 'cancelled') return existing;
      throw AppError.conflict('La propuesta ya no está pendiente');
    }
    await this.audit(this.deps.db, actor, row, 'cancelled', { reason: 'user' });
    return ProposalsService.toDto(row);
  }

  async expireStale(): Promise<number> {
    const rows = await this.deps.db
      .update(actionProposals)
      .set({ status: 'expired' })
      .where(and(eq(actionProposals.status, 'pending'), lt(actionProposals.expiresAt, new Date())))
      .returning({ id: actionProposals.id });
    return rows.length;
  }

  private async audit(db: DbOrTx, actor: Actor, row: Row, outcome: 'success' | 'denied' | 'failed' | 'cancelled', metadata: Record<string, unknown>) {
    await recordAudit(db, actor, {
      action: `proposals.${outcome === 'success' ? 'execute' : outcome}`,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      outcome,
      proposalId: row.id,
      metadata: { proposedAction: row.action, source: row.source, ...metadata },
    });
  }
}
