import { assertCan, recordAudit, SettingsService, type Actor } from '@starter/auth';
import { AppError, type BudgetInput } from '@starter/contracts';
import {
  and,
  budgetAlerts,
  budgets,
  budgetUsage,
  eq,
  inArray,
  isNull,
  lt,
  memberships,
  or,
  reservations,
  rolePermissions,
  roles,
  sql,
  userRoles,
  users,
  type DbOrTx,
} from '@starter/db';
import { budgetAlertEmail } from '@starter/mail';
import { add, compare, displayUsd, fromUnits, percent, sub, toUnits, ZERO } from '../money.js';
import type { AiDeps } from './connections.js';

type BudgetRow = typeof budgets.$inferSelect;

export interface BudgetScope {
  organizationId: string;
  userId?: string | null;
  agentId?: string | null;
  feature?: string | null;
}

/** UTC period start (documented: budgets are evaluated in UTC). */
export function periodStart(period: 'day' | 'month', at = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  return period === 'day' ? `${y}-${m}-${d}` : `${y}-${m}-01`;
}

export class BudgetExceededError extends AppError {
  constructor(budget: string, limit: string, used: string) {
    super('BUDGET_EXCEEDED', `Presupuesto «${budget}» alcanzado (${displayUsd(used)} de ${displayUsd(limit)})`, { budget, limit, used });
  }
}

/**
 * Budgets with atomic reservations: before executing, the estimated cost is reserved under a
 * row lock of each applicable budget period (SELECT … FOR UPDATE), so concurrent requests cannot
 * jointly exceed a hard limit by more than the estimate error. Settlement replaces the
 * reservation with the final cost (or keeps the estimate when the final cost is unknown).
 */
export class BudgetsService {
  constructor(private readonly deps: AiDeps) {}

  private toDto(b: BudgetRow, usage?: { spentUsd: string; reservedUsd: string }) {
    const spent = usage?.spentUsd ?? ZERO;
    return {
      id: b.id,
      name: b.name,
      scopeType: b.scopeType as 'organization' | 'user' | 'agent' | 'feature',
      scopeId: b.scopeId,
      period: b.period,
      limitUsd: b.limitUsd,
      alertThresholds: b.alertThresholds,
      hardLimit: b.hardLimit,
      enabled: b.enabled,
      current: { periodStart: periodStart(b.period), spentUsd: spent, reservedUsd: usage?.reservedUsd ?? ZERO, percent: percent(spent, b.limitUsd) },
      createdAt: b.createdAt.toISOString(),
    };
  }

  async list(actor: Actor) {
    if (!actor.permissions.has('ai.budgets.manage') && !actor.permissions.has('ai.usage.read')) assertCan(actor, 'ai.budgets.manage');
    const rows = await this.deps.db.select().from(budgets).where(eq(budgets.organizationId, actor.organizationId)).orderBy(budgets.name);
    const usage = rows.length
      ? await this.deps.db
          .select()
          .from(budgetUsage)
          .where(inArray(budgetUsage.budgetId, rows.map((r) => r.id)))
      : [];
    return rows.map((b) => this.toDto(b, usage.find((u) => u.budgetId === b.id && u.periodStart === periodStart(b.period))));
  }

  async create(actor: Actor, input: BudgetInput) {
    assertCan(actor, 'ai.budgets.manage');
    if (compare(input.limitUsd, '0') <= 0) throw AppError.validation('El límite debe ser mayor que cero');
    const [b] = await this.deps.db
      .insert(budgets)
      .values({ ...input, scopeId: input.scopeType === 'organization' ? null : (input.scopeId ?? null), limitUsd: fromUnits(toUnits(input.limitUsd)), organizationId: actor.organizationId, createdBy: actor.userId })
      .returning();
    await recordAudit(this.deps.db, actor, { action: 'ai.budgets.create', resourceType: 'budget', resourceId: b!.id, outcome: 'success', after: input });
    return this.toDto(b!);
  }

  async update(actor: Actor, id: string, input: BudgetInput) {
    assertCan(actor, 'ai.budgets.manage');
    const [before] = await this.deps.db.select().from(budgets).where(and(eq(budgets.id, id), eq(budgets.organizationId, actor.organizationId)));
    if (!before) throw AppError.notFound('Presupuesto');
    const [b] = await this.deps.db
      .update(budgets)
      .set({ ...input, scopeId: input.scopeType === 'organization' ? null : (input.scopeId ?? null), limitUsd: fromUnits(toUnits(input.limitUsd)) })
      .where(eq(budgets.id, id))
      .returning();
    await recordAudit(this.deps.db, actor, { action: 'ai.budgets.update', resourceType: 'budget', resourceId: id, outcome: 'success', before: { limitUsd: before.limitUsd, hardLimit: before.hardLimit, enabled: before.enabled }, after: input });
    return (await this.list(actor)).find((x) => x.id === b!.id)!;
  }

  async remove(actor: Actor, id: string) {
    assertCan(actor, 'ai.budgets.manage');
    const rows = await this.deps.db.delete(budgets).where(and(eq(budgets.id, id), eq(budgets.organizationId, actor.organizationId))).returning();
    if (!rows.length) throw AppError.notFound('Presupuesto');
    await recordAudit(this.deps.db, actor, { action: 'ai.budgets.delete', resourceType: 'budget', resourceId: id, outcome: 'success', before: { name: rows[0]!.name } });
  }

  private async applicable(scope: BudgetScope, db: DbOrTx): Promise<BudgetRow[]> {
    return db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.organizationId, scope.organizationId),
          eq(budgets.enabled, true),
          or(
            eq(budgets.scopeType, 'organization'),
            scope.userId ? and(eq(budgets.scopeType, 'user'), eq(budgets.scopeId, scope.userId)) : sql`false`,
            scope.agentId ? and(eq(budgets.scopeType, 'agent'), eq(budgets.scopeId, scope.agentId)) : sql`false`,
            scope.feature ? and(eq(budgets.scopeType, 'feature'), eq(budgets.scopeId, scope.feature)) : sql`false`,
          ),
        ),
      )
      .orderBy(budgets.id);
  }

  /** True when a hard budget applies (callers must then be able to estimate the cost). */
  async hasHardLimit(scope: BudgetScope): Promise<boolean> {
    return (await this.applicable(scope, this.deps.db)).some((b) => b.hardLimit);
  }

  /**
   * Atomically reserves `amountUsd` in every applicable budget. Throws BudgetExceededError when a
   * hard limit would be exceeded. Returns null when no budget applies.
   */
  async reserve(scope: BudgetScope, amountUsd: string, aiRequestId: string | null = null): Promise<string | null> {
    return this.deps.db.transaction(async (tx) => {
      const list = await this.applicable(scope, tx);
      if (!list.length) return null;
      const periodStarts: string[] = [];
      for (const b of list) {
        const ps = periodStart(b.period);
        periodStarts.push(ps);
        await tx.insert(budgetUsage).values({ budgetId: b.id, periodStart: ps }).onConflictDoNothing();
        const [u] = (
          await tx.execute<{ spent_usd: string; reserved_usd: string }>(
            sql`select spent_usd, reserved_usd from ${budgetUsage} where budget_id = ${b.id} and period_start = ${ps} for update`,
          )
        ).rows;
        const used = add(u!.spent_usd, u!.reserved_usd);
        if (b.hardLimit && compare(add(used, amountUsd), b.limitUsd) > 0) throw new BudgetExceededError(b.name, b.limitUsd, used);
        await tx
          .update(budgetUsage)
          .set({ reservedUsd: sql`${budgetUsage.reservedUsd} + ${amountUsd}::numeric` })
          .where(and(eq(budgetUsage.budgetId, b.id), eq(budgetUsage.periodStart, ps)));
      }
      const [r] = await tx
        .insert(reservations)
        .values({ aiRequestId, budgetIds: list.map((b) => b.id), periodStarts, amountUsd, expiresAt: new Date(Date.now() + 30 * 60_000) })
        .returning({ id: reservations.id });
      return r!.id;
    });
  }

  /** Replaces the reservation by the final cost (estimate kept when the final cost is unknown). */
  async settle(reservationId: string | null, finalUsd: string | null): Promise<void> {
    if (!reservationId) return;
    await this.deps.db.transaction(async (tx) => {
      const [r] = (
        await tx.execute<{ id: string; budget_ids: string[]; period_starts: string[]; amount_usd: string; status: string }>(
          sql`select id, budget_ids, period_starts, amount_usd, status from ${reservations} where id = ${reservationId} for update`,
        )
      ).rows;
      if (!r || r.status !== 'reserved') return;
      const charge = finalUsd ?? r.amount_usd;
      for (let i = 0; i < r.budget_ids.length; i++) {
        await tx
          .update(budgetUsage)
          .set({
            reservedUsd: sql`greatest(0, ${budgetUsage.reservedUsd} - ${r.amount_usd}::numeric)`,
            spentUsd: sql`${budgetUsage.spentUsd} + ${charge}::numeric`,
          })
          .where(and(eq(budgetUsage.budgetId, r.budget_ids[i]!), eq(budgetUsage.periodStart, r.period_starts[i]!)));
      }
      await tx.update(reservations).set({ status: 'settled', settledUsd: charge, settledAt: new Date() }).where(eq(reservations.id, reservationId));
    });
  }

  /** Releases a reservation when nothing billable happened. */
  async release(reservationId: string | null): Promise<void> {
    if (!reservationId) return;
    await this.deps.db.transaction(async (tx) => {
      const [r] = (
        await tx.execute<{ budget_ids: string[]; period_starts: string[]; amount_usd: string; status: string }>(
          sql`select budget_ids, period_starts, amount_usd, status from ${reservations} where id = ${reservationId} for update`,
        )
      ).rows;
      if (!r || r.status !== 'reserved') return;
      for (let i = 0; i < r.budget_ids.length; i++) {
        await tx
          .update(budgetUsage)
          .set({ reservedUsd: sql`greatest(0, ${budgetUsage.reservedUsd} - ${r.amount_usd}::numeric)` })
          .where(and(eq(budgetUsage.budgetId, r.budget_ids[i]!), eq(budgetUsage.periodStart, r.period_starts[i]!)));
      }
      await tx.update(reservations).set({ status: 'released', settledAt: new Date() }).where(eq(reservations.id, reservationId));
    });
  }

  /** Maintenance: reservations abandoned by crashed processes are settled conservatively. */
  async expireStale(): Promise<number> {
    const stale = await this.deps.db
      .select({ id: reservations.id })
      .from(reservations)
      .where(and(eq(reservations.status, 'reserved'), lt(reservations.expiresAt, new Date())));
    for (const s of stale) await this.settle(s.id, null);
    return stale.length;
  }

  /** Sends threshold alerts once per budget/period/threshold to users with ai.budgets.manage. */
  async evaluateAlerts(): Promise<number> {
    const rows = await this.deps.db.select({ b: budgets, u: budgetUsage }).from(budgets).innerJoin(budgetUsage, eq(budgetUsage.budgetId, budgets.id)).where(eq(budgets.enabled, true));
    let sent = 0;
    const settings = new SettingsService(this.deps);
    for (const { b, u } of rows) {
      if (u.periodStart !== periodStart(b.period)) continue;
      const pct = percent(u.spentUsd, b.limitUsd);
      for (const threshold of [...b.alertThresholds].sort((x, y) => x - y)) {
        if (pct < threshold) continue;
        const inserted = await this.deps.db
          .insert(budgetAlerts)
          .values({ budgetId: b.id, periodStart: u.periodStart, threshold, spentUsd: u.spentUsd })
          .onConflictDoNothing()
          .returning({ id: budgetAlerts.id });
        if (!inserted.length) continue;
        const recipients = await this.deps.db
          .selectDistinct({ email: users.email })
          .from(users)
          .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organizationId, b.organizationId)))
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          // Members of the budget's organization whose platform role, or role in that organization, can manage budgets.
          .where(
            and(
              sql`${users.disabledAt} is null`,
              or(isNull(userRoles.organizationId), eq(userRoles.organizationId, b.organizationId)),
              or(eq(roles.key, 'owner'), eq(rolePermissions.permissionKey, 'ai.budgets.manage')),
            ),
          );
        const branding = await settings.branding();
        const tpl = budgetAlertEmail({ appName: branding.appName, primaryColor: branding.primaryColor, appUrl: this.deps.env.APP_URL }, b.name, threshold, displayUsd(u.spentUsd), displayUsd(b.limitUsd));
        const data = { budgetName: b.name, threshold: String(threshold), spent: displayUsd(u.spentUsd), limit: displayUsd(b.limitUsd), budgetsUrl: `${this.deps.env.APP_URL.replace(/\/$/, '')}/admin/ai/budgets` };
        for (const r of recipients) await this.deps.mailer.send({ to: r.email, ...tpl, category: 'budget-alert', template: { key: 'ai.budget_alert', data } }).catch(() => undefined);
        await this.deps.db.update(budgetAlerts).set({ notifiedAt: new Date() }).where(eq(budgetAlerts.id, inserted[0]!.id));
        sent++;
      }
    }
    return sent;
  }

  /** Remaining room in the tightest applicable hard budget (null = unlimited). */
  async remaining(scope: BudgetScope): Promise<string | null> {
    const list = (await this.applicable(scope, this.deps.db)).filter((b) => b.hardLimit);
    let min: string | null = null;
    for (const b of list) {
      const [u] = await this.deps.db.select().from(budgetUsage).where(and(eq(budgetUsage.budgetId, b.id), eq(budgetUsage.periodStart, periodStart(b.period))));
      const left = sub(b.limitUsd, add(u?.spentUsd, u?.reservedUsd));
      if (min === null || compare(left, min) < 0) min = left;
    }
    return min;
  }
}
