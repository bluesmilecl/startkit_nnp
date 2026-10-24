import { sha256 } from '@starter/config';
import {
  AppError,
  type CreateUserInput,
  type UpdateUserInput,
  type UserDetail,
  type UserSummary,
  type UsersListQuery,
} from '@starter/contracts';
import {
  and,
  asc,
  attachments,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  invitations,
  isNotNull,
  isNull,
  likeTerm,
  memberships,
  normalizePage,
  offsetOf,
  or,
  organizations,
  roles,
  sessions,
  sql,
  toPage,
  userRoles,
  users,
  type DbOrTx,
  type Page,
  type SQL,
} from '@starter/db';
import { assertCan, type AccessDeps, type Actor } from './actor.js';
import { maskEmail, recordAudit } from './audit.js';
import { assertCanManageRole, assertCanManageUser, assertNotLastOwner, targetUserInfo } from './policies.js';
import { RolesService } from './roles.js';
import { InvitationsService } from './invitations.js';

type UserRow = typeof users.$inferSelect;

export interface UserCandidate {
  id: string;
  email: string;
  name: string;
  status: UserSummary['status'];
}

export type AccessEvent =
  | { type: 'user.deleted'; userId: string; storageKeys: string[] }
  | { type: 'user.disabled'; userId: string }
  | { type: 'roles.changed'; userId: string };

export class UsersService {
  private readonly rolesService: RolesService;
  private readonly invitationsService: InvitationsService;

  constructor(private readonly deps: AccessDeps) {
    this.rolesService = new RolesService(deps);
    this.invitationsService = new InvitationsService(deps);
  }

  static status(u: Pick<UserRow, 'disabledAt' | 'emailVerified' | 'lastLoginAt'>): UserSummary['status'] {
    if (u.disabledAt) return 'disabled';
    if (!u.emailVerified && !u.lastLoginAt) return 'pending';
    return 'active';
  }

  /** Users visible to the actor: everyone with platform users.read, otherwise members of the active org. */
  private scopeFilter(actor: Actor): SQL | undefined {
    if (actor.platformPermissions.has('users.read')) return undefined;
    return exists(
      this.deps.db
        .select({ one: sql`1` })
        .from(memberships)
        .where(and(eq(memberships.userId, users.id), eq(memberships.organizationId, actor.organizationId))),
    );
  }

  private async rolesFor(userIds: string[], db: DbOrTx = this.deps.db) {
    if (!userIds.length) return new Map<string, UserSummary['roles']>();
    const rows = await db
      .select({ userId: userRoles.userId, id: roles.id, key: roles.key, name: roles.name, organizationId: userRoles.organizationId, rank: roles.rank })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(inArray(userRoles.userId, userIds))
      .orderBy(desc(roles.rank));
    const map = new Map<string, UserSummary['roles']>();
    for (const r of rows) {
      const list = map.get(r.userId) ?? [];
      list.push({ id: r.id, key: r.key, name: r.name, organizationId: r.organizationId });
      map.set(r.userId, list);
    }
    return map;
  }

  private toSummary(u: UserRow, userRolesList: UserSummary['roles']): UserSummary {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      image: u.image,
      emailVerified: u.emailVerified,
      status: UsersService.status(u),
      roles: userRolesList,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      disabledAt: u.disabledAt?.toISOString() ?? null,
    };
  }

  async list(actor: Actor, query: UsersListQuery): Promise<Page<UserSummary>> {
    assertCan(actor, 'users.read');
    const params = normalizePage(query);
    const filters: (SQL | undefined)[] = [this.scopeFilter(actor)];
    if (query.search) {
      const term = likeTerm(query.search);
      filters.push(or(ilike(users.email, term), ilike(users.name, term)));
    }
    if (query.status === 'disabled') filters.push(isNotNull(users.disabledAt));
    if (query.status === 'active') filters.push(and(isNull(users.disabledAt), or(eq(users.emailVerified, true), isNotNull(users.lastLoginAt))));
    if (query.status === 'pending') filters.push(and(isNull(users.disabledAt), eq(users.emailVerified, false), isNull(users.lastLoginAt)));
    if (query.roleId) {
      filters.push(
        exists(
          this.deps.db
            .select({ one: sql`1` })
            .from(userRoles)
            .where(and(eq(userRoles.userId, users.id), eq(userRoles.roleId, query.roleId))),
        ),
      );
    }
    const where = and(...filters.filter(Boolean));
    const sortCol = { createdAt: users.createdAt, name: users.name, email: users.email, lastLoginAt: users.lastLoginAt }[query.sort];
    const [rows, totalRow] = await Promise.all([
      this.deps.db
        .select()
        .from(users)
        .where(where)
        .orderBy(query.direction === 'asc' ? asc(sortCol) : sql`${sortCol} desc nulls last`, asc(users.id))
        .limit(params.pageSize)
        .offset(offsetOf(params)),
      this.deps.db.select({ n: count() }).from(users).where(where),
    ]);
    const roleMap = await this.rolesFor(rows.map((r) => r.id));
    return toPage(
      rows.map((u) => this.toSummary(u, roleMap.get(u.id) ?? [])),
      totalRow[0]?.n ?? 0,
      params,
    );
  }

  async findVisible(actor: Actor, id: string, db: DbOrTx = this.deps.db): Promise<UserRow> {
    assertCan(actor, 'users.read');
    const [u] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), this.scopeFilter(actor)))
      .limit(1);
    if (!u) throw AppError.notFound('Usuario');
    return u;
  }

  async version(u: UserRow, db: DbOrTx = this.deps.db): Promise<string> {
    const r = await this.rolesFor([u.id], db);
    const roleIds = (r.get(u.id) ?? []).map((x) => `${x.id}:${x.organizationId ?? ''}`).sort();
    return sha256([u.updatedAt.toISOString(), u.disabledAt?.toISOString() ?? '', u.name, ...roleIds].join('|')).slice(0, 16);
  }

  async get(actor: Actor, id: string): Promise<UserDetail> {
    const u = await this.findVisible(actor, id);
    const db = this.deps.db;
    const [roleMap, orgs, sessionCount, version] = await Promise.all([
      this.rolesFor([u.id]),
      db
        .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, isDefault: organizations.isDefault })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .where(eq(memberships.userId, u.id)),
      db
        .select({ n: count() })
        .from(sessions)
        .where(and(eq(sessions.userId, u.id), sql`${sessions.expiresAt} > now()`)),
      this.version(u),
    ]);
    return {
      ...this.toSummary(u, roleMap.get(u.id) ?? []),
      locale: u.locale,
      timezone: u.timezone,
      disabledReason: u.disabledReason,
      updatedAt: u.updatedAt.toISOString(),
      organizations: orgs,
      sessionCount: sessionCount[0]?.n ?? 0,
      version,
    };
  }

  /**
   * Resolves people for chat tools before modifying anything: exact e-mail match wins, otherwise
   * returns every candidate so that the user can choose (never guesses on ambiguity).
   */
  async resolve(actor: Actor, term: string, limit = 10): Promise<UserCandidate[]> {
    assertCan(actor, 'users.read');
    const t = term.trim();
    if (!t) return [];
    const scope = this.scopeFilter(actor);
    const exact = await this.deps.db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${t})`, scope))
      .limit(1);
    const rows = exact.length
      ? exact
      : await this.deps.db
          .select()
          .from(users)
          .where(and(or(ilike(users.name, likeTerm(t)), ilike(users.email, likeTerm(t))), scope))
          .orderBy(asc(users.name))
          .limit(limit);
    return rows.map((u) => ({ id: u.id, email: u.email, name: u.name, status: UsersService.status(u) }));
  }

  async create(actor: Actor, input: CreateUserInput): Promise<UserDetail> {
    assertCan(actor, 'users.create');
    if (input.roleIds.length) assertCan(actor, 'roles.manage');
    if (input.sendInvitation) assertCan(actor, 'users.invite');
    const email = input.email.toLowerCase();
    const id = await this.deps.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      if (dup) throw AppError.conflict('Ya existe un usuario con ese correo', { userId: dup.id });
      const roleRows = [];
      for (const roleId of input.roleIds) {
        const role = await this.rolesService.findVisible(actor, roleId, tx);
        assertCanManageRole(actor, role);
        roleRows.push(role);
      }
      const [created] = await tx.insert(users).values({ email, name: input.name, emailVerified: false }).returning();
      await tx.insert(memberships).values({ userId: created!.id, organizationId: actor.organizationId }).onConflictDoNothing();
      for (const role of roleRows) {
        const orgId = role.scope === 'organization' && this.deps.features.organizations ? actor.organizationId : null;
        await tx.insert(userRoles).values({ userId: created!.id, roleId: role.id, organizationId: orgId, assignedBy: actor.userId });
      }
      await recordAudit(tx, actor, {
        action: 'users.create',
        resourceType: 'user',
        resourceId: created!.id,
        outcome: 'success',
        after: { email, name: input.name, roles: roleRows.map((r) => r.key) },
      });
      return created!.id;
    });
    if (input.sendInvitation) {
      await this.invitationsService.notifyExistingUser(actor, email, input.roleIds[0] ?? null);
    }
    return this.get(actor, id);
  }

  async update(actor: Actor, id: string, input: UpdateUserInput, expectedVersion?: string): Promise<UserDetail> {
    assertCan(actor, 'users.update');
    await this.deps.db.transaction(async (tx) => {
      const u = await this.findVisible(actor, id, tx);
      if (u.id !== actor.userId) assertCanManageUser(actor, await targetUserInfo(tx, u.id), 'editar');
      if (expectedVersion && expectedVersion !== (await this.version(u, tx))) {
        throw AppError.precondition('El usuario cambió desde que lo abriste; recarga y vuelve a intentar');
      }
      const patch: Partial<UserRow> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.locale !== undefined) patch.locale = input.locale;
      if (input.timezone !== undefined) patch.timezone = input.timezone;
      if (!Object.keys(patch).length) return;
      await tx.update(users).set(patch).where(eq(users.id, u.id));
      await recordAudit(tx, actor, {
        action: 'users.update',
        resourceType: 'user',
        resourceId: u.id,
        outcome: 'success',
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, u[k as keyof UserRow]])),
        after: patch,
      });
    });
    return this.get(actor, id);
  }

  async planDisable(actor: Actor, id: string, db: DbOrTx = this.deps.db) {
    assertCan(actor, 'users.disable');
    const u = await this.findVisible(actor, id, db);
    const target = await targetUserInfo(db, u.id);
    assertCanManageUser(actor, target, 'desactivar');
    if (!u.disabledAt) await assertNotLastOwner(db, target, 'desactivar al usuario');
    const [s] = await db
      .select({ n: count() })
      .from(sessions)
      .where(and(eq(sessions.userId, u.id), sql`${sessions.expiresAt} > now()`));
    return { user: u, activeSessions: s?.n ?? 0 };
  }

  async disable(actor: Actor, id: string, reason?: string): Promise<UserDetail> {
    await this.deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(727002)`);
      const { user } = await this.planDisable(actor, id, tx);
      if (user.disabledAt) return;
      await tx
        .update(users)
        .set({ disabledAt: new Date(), disabledReason: reason ?? null })
        .where(eq(users.id, user.id));
      const revoked = await tx.delete(sessions).where(eq(sessions.userId, user.id)).returning({ id: sessions.id });
      await recordAudit(tx, actor, {
        action: 'users.disable',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'success',
        before: { disabledAt: null },
        after: { disabledAt: new Date().toISOString(), reason: reason ?? null },
        metadata: { revokedSessions: revoked.length },
      });
    });
    await this.deps.onEvent?.({ type: 'user.disabled', userId: id });
    return this.get(actor, id);
  }

  async enable(actor: Actor, id: string): Promise<UserDetail> {
    assertCan(actor, 'users.disable');
    await this.deps.db.transaction(async (tx) => {
      const u = await this.findVisible(actor, id, tx);
      assertCanManageUser(actor, await targetUserInfo(tx, u.id), 'reactivar');
      if (!u.disabledAt) return;
      await tx.update(users).set({ disabledAt: null, disabledReason: null }).where(eq(users.id, u.id));
      await recordAudit(tx, actor, {
        action: 'users.enable',
        resourceType: 'user',
        resourceId: u.id,
        outcome: 'success',
        before: { disabledAt: u.disabledAt.toISOString() },
        after: { disabledAt: null },
      });
    });
    return this.get(actor, id);
  }

  async planDelete(actor: Actor, id: string, db: DbOrTx = this.deps.db) {
    assertCan(actor, 'users.delete');
    const u = await this.findVisible(actor, id, db);
    const target = await targetUserInfo(db, u.id);
    assertCanManageUser(actor, target, 'eliminar');
    await assertNotLastOwner(db, target, 'eliminar al usuario');
    const [att] = await db.select({ n: count() }).from(attachments).where(eq(attachments.userId, u.id));
    const [ses] = await db.select({ n: count() }).from(sessions).where(eq(sessions.userId, u.id));
    const roleMap = await this.rolesFor([u.id], db);
    return { user: u, roles: roleMap.get(u.id) ?? [], attachments: att?.n ?? 0, sessions: ses?.n ?? 0 };
  }

  /**
   * Deletes the account: revokes access (sessions/accounts), removes memberships and role
   * assignments, deletes personal conversations and schedules purge of stored files.
   * Audit events and cost records keep only pseudonymous ids and are never deleted here.
   */
  async delete(actor: Actor, id: string): Promise<{ purgedFiles: number }> {
    const storageKeys = await this.deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(727002)`);
      const plan = await this.planDelete(actor, id, tx);
      const files = await tx.select({ key: attachments.storageKey }).from(attachments).where(eq(attachments.userId, plan.user.id));
      await tx
        .update(invitations)
        .set({ status: 'revoked' })
        .where(and(sql`lower(${invitations.email}) = lower(${plan.user.email})`, eq(invitations.status, 'pending')));
      await tx.delete(users).where(eq(users.id, plan.user.id));
      await recordAudit(tx, actor, {
        action: 'users.delete',
        resourceType: 'user',
        resourceId: plan.user.id,
        outcome: 'success',
        before: { email: maskEmail(plan.user.email), roles: plan.roles.map((r) => r.key), sessions: plan.sessions, attachments: plan.attachments },
        after: null,
        metadata: { retention: 'personal data removed; audit and usage keep pseudonymous ids' },
      });
      return files.map((f) => f.key);
    });
    await this.deps.onEvent?.({ type: 'user.deleted', userId: id, storageKeys });
    return { purgedFiles: storageKeys.length };
  }

  async revokeSessions(actor: Actor, id: string): Promise<{ revoked: number }> {
    assertCan(actor, 'users.disable');
    return this.deps.db.transaction(async (tx) => {
      const u = await this.findVisible(actor, id, tx);
      if (u.id !== actor.userId) assertCanManageUser(actor, await targetUserInfo(tx, u.id), 'revocar sesiones de');
      const revoked = await tx.delete(sessions).where(eq(sessions.userId, u.id)).returning({ id: sessions.id });
      await recordAudit(tx, actor, {
        action: 'users.revokeSessions',
        resourceType: 'user',
        resourceId: u.id,
        outcome: 'success',
        metadata: { revoked: revoked.length },
      });
      return { revoked: revoked.length };
    });
  }

  async assignRole(actor: Actor, userId: string, roleId: string, organizationId?: string | null): Promise<UserDetail> {
    await this.findVisible(actor, userId);
    await this.rolesService.assign(actor, userId, roleId, organizationId);
    await this.deps.onEvent?.({ type: 'roles.changed', userId });
    return this.get(actor, userId);
  }

  async removeRole(actor: Actor, userId: string, roleId: string, organizationId?: string | null): Promise<UserDetail> {
    await this.findVisible(actor, userId);
    await this.rolesService.unassign(actor, userId, roleId, organizationId);
    await this.deps.onEvent?.({ type: 'roles.changed', userId });
    return this.get(actor, userId);
  }
}
