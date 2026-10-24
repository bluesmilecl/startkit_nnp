import {
  AppError,
  PERMISSION_KEYS,
  type CreateRoleInput,
  type PermissionKey,
  type RoleDetail,
  type RoleSummary,
  type UpdateRoleInput,
} from '@starter/contracts';
import { and, asc, count, type DbOrTx, eq, inArray, isNull, or, outerRef, permissions, rolePermissions, roles, sql, userRoles, users } from '@starter/db';
import { assertCan, type AccessDeps, type Actor } from './actor.js';
import { recordAudit } from './audit.js';
import { assertCanManageRole, assertCanManageUser, assertDelegable, assertNotLastOwner, targetUserInfo } from './policies.js';

type RoleRow = typeof roles.$inferSelect;

export interface PermissionsPlan {
  role: RoleRow;
  before: PermissionKey[];
  after: PermissionKey[];
  added: PermissionKey[];
  removed: PermissionKey[];
}

export interface AssignmentPlan {
  userId: string;
  userEmail: string;
  role: RoleRow;
  organizationId: string | null;
  alreadyAssigned: boolean;
}

export class RolesService {
  constructor(private readonly deps: AccessDeps) {}

  private visibleRolesFilter(actor: Actor) {
    return this.deps.features.organizations
      ? or(isNull(roles.organizationId), eq(roles.organizationId, actor.organizationId))
      : isNull(roles.organizationId);
  }

  async list(actor: Actor): Promise<RoleSummary[]> {
    assertCan(actor, 'roles.read');
    const db = this.deps.db;
    const rows = await db
      .select({
        role: roles,
        userCount: sql<number>`(select count(*)::int from ${userRoles} ur where ur.role_id = ${outerRef(roles.id)})`,
        permissionCount: sql<number>`(select count(*)::int from ${rolePermissions} rp where rp.role_id = ${outerRef(roles.id)})`,
      })
      .from(roles)
      .where(this.visibleRolesFilter(actor))
      .orderBy(sql`${roles.rank} desc`, asc(roles.name));
    return rows.map((r) => this.toSummary(r.role, r.userCount, r.role.key === 'owner' ? PERMISSION_KEYS.length : r.permissionCount));
  }

  private toSummary(role: RoleRow, userCount: number, permissionCount: number): RoleSummary {
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      scope: role.scope,
      isSystem: role.isSystem,
      rank: role.rank,
      organizationId: role.organizationId,
      userCount,
      permissionCount,
      version: role.version,
    };
  }

  async findVisible(actor: Actor, idOrKey: string, db: DbOrTx = this.deps.db): Promise<RoleRow> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrKey);
    const [role] = await db
      .select()
      .from(roles)
      .where(and(isUuid ? eq(roles.id, idOrKey) : eq(roles.key, idOrKey), this.visibleRolesFilter(actor)))
      .limit(1);
    if (!role) throw AppError.notFound('Rol');
    return role;
  }

  async rolePermissionKeys(roleId: string, db: DbOrTx = this.deps.db): Promise<PermissionKey[]> {
    const rows = await db
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId))
      .orderBy(asc(rolePermissions.permissionKey));
    return rows.map((r) => r.key as PermissionKey);
  }

  private editable(actor: Actor, role: RoleRow): boolean {
    if (role.key === 'owner') return false;
    if (!actor.permissions.has('roles.manage')) return false;
    if (actor.isOwner) return true;
    return role.rank < actor.maxRank;
  }

  async get(actor: Actor, id: string): Promise<RoleDetail> {
    assertCan(actor, 'roles.read');
    const role = await this.findVisible(actor, id);
    const perms = role.key === 'owner' ? [...PERMISSION_KEYS] : await this.rolePermissionKeys(role.id);
    const [uc] = await this.deps.db.select({ n: count() }).from(userRoles).where(eq(userRoles.roleId, role.id));
    return { ...this.toSummary(role, uc?.n ?? 0, perms.length), permissions: perms, editable: this.editable(actor, role) };
  }

  async catalog(actor: Actor) {
    assertCan(actor, 'permissions.read');
    const rows = await this.deps.db
      .select()
      .from(permissions)
      .where(isNull(permissions.deprecatedAt))
      .orderBy(asc(permissions.group), asc(permissions.key));
    return rows.map((p) => ({ key: p.key, group: p.group, description: p.description, sensitive: p.sensitive, source: p.source }));
  }

  async matrix(actor: Actor) {
    assertCan(actor, 'permissions.read');
    assertCan(actor, 'roles.read');
    const [perms, list] = await Promise.all([this.catalog(actor), this.list(actor)]);
    const details = await Promise.all(list.map((r) => this.get(actor, r.id)));
    return { permissions: perms, roles: details };
  }

  async create(actor: Actor, input: CreateRoleInput): Promise<RoleDetail> {
    assertCan(actor, 'roles.manage');
    if (input.permissions.length) assertCan(actor, 'permissions.manage');
    const organizationId = input.scope === 'organization' && this.deps.features.organizations ? actor.organizationId : null;
    assertCanManageRole(actor, { key: input.key, rank: input.rank, organizationId });
    const perms = assertDelegable(actor, input.permissions);
    const id = await this.deps.db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.key, input.key), organizationId ? eq(roles.organizationId, organizationId) : isNull(roles.organizationId)))
        .limit(1);
      if (dup) throw AppError.conflict(`Ya existe un rol con la clave "${input.key}"`);
      const [role] = await tx
        .insert(roles)
        .values({
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          rank: input.rank,
          scope: organizationId ? 'organization' : 'platform',
          organizationId,
          isSystem: false,
        })
        .returning();
      if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ roleId: role!.id, permissionKey: p })));
      await recordAudit(tx, actor, {
        action: 'roles.create',
        resourceType: 'role',
        resourceId: role!.id,
        outcome: 'success',
        after: { key: role!.key, name: role!.name, rank: role!.rank, permissions: perms },
      });
      return role!.id;
    });
    return this.get(actor, id);
  }

  async update(actor: Actor, id: string, input: UpdateRoleInput): Promise<RoleDetail> {
    assertCan(actor, 'roles.manage');
    await this.deps.db.transaction(async (tx) => {
      const role = await this.findVisible(actor, id, tx);
      assertCanManageRole(actor, role);
      if (role.key === 'owner') throw AppError.forbidden('El rol propietario no se puede modificar');
      if (input.expectedVersion !== undefined && input.expectedVersion !== role.version) {
        throw AppError.precondition('El rol cambió desde que lo abriste; recarga y vuelve a intentar');
      }
      if (input.rank !== undefined && !actor.isOwner && input.rank >= actor.maxRank) {
        throw AppError.forbidden('No puedes elevar un rol a tu jerarquía o superior');
      }
      const patch = {
        name: input.name ?? role.name,
        description: input.description === undefined ? role.description : input.description,
        rank: role.isSystem ? role.rank : (input.rank ?? role.rank),
      };
      await tx
        .update(roles)
        .set({ ...patch, version: role.version + 1 })
        .where(eq(roles.id, role.id));
      await recordAudit(tx, actor, {
        action: 'roles.update',
        resourceType: 'role',
        resourceId: role.id,
        outcome: 'success',
        before: { name: role.name, description: role.description, rank: role.rank },
        after: patch,
      });
    });
    return this.get(actor, id);
  }

  async planDelete(actor: Actor, id: string, db: DbOrTx = this.deps.db): Promise<{ role: RoleRow; assignedUsers: number }> {
    assertCan(actor, 'roles.manage');
    const role = await this.findVisible(actor, id, db);
    assertCanManageRole(actor, role);
    if (role.isSystem) throw AppError.forbidden('Los roles del sistema no se pueden eliminar');
    const [uc] = await db.select({ n: count() }).from(userRoles).where(eq(userRoles.roleId, role.id));
    return { role, assignedUsers: uc?.n ?? 0 };
  }

  async delete(actor: Actor, id: string): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      const { role, assignedUsers } = await this.planDelete(actor, id, tx);
      if (assignedUsers > 0) {
        throw AppError.conflict(`El rol tiene ${assignedUsers} usuario(s) asignado(s); quítalos antes de eliminarlo`, { assignedUsers });
      }
      const perms = await this.rolePermissionKeys(role.id, tx);
      await tx.delete(roles).where(eq(roles.id, role.id));
      await recordAudit(tx, actor, {
        action: 'roles.delete',
        resourceType: 'role',
        resourceId: role.id,
        outcome: 'success',
        before: { key: role.key, name: role.name, rank: role.rank, permissions: perms },
      });
    });
  }

  async planSetPermissions(actor: Actor, id: string, desired: string[], db: DbOrTx = this.deps.db): Promise<PermissionsPlan> {
    assertCan(actor, 'permissions.manage');
    const role = await this.findVisible(actor, id, db);
    if (role.key === 'owner') throw AppError.forbidden('Los permisos del rol propietario son inmutables');
    assertCanManageRole(actor, role);
    const before = await this.rolePermissionKeys(role.id, db);
    const desiredKeys = [...new Set(desired)].sort();
    const added = desiredKeys.filter((k) => !before.includes(k as PermissionKey));
    const removed = before.filter((k) => !desiredKeys.includes(k));
    // Only newly granted permissions must be delegable; removing is allowed for manageable roles.
    assertDelegable(actor, added);
    return { role, before, after: desiredKeys as PermissionKey[], added: added as PermissionKey[], removed };
  }

  async setPermissions(actor: Actor, id: string, desired: string[], expectedVersion?: number): Promise<RoleDetail> {
    await this.deps.db.transaction(async (tx) => {
      const plan = await this.planSetPermissions(actor, id, desired, tx);
      if (expectedVersion !== undefined && expectedVersion !== plan.role.version) {
        throw AppError.precondition('El rol cambió desde que lo abriste; recarga y vuelve a intentar');
      }
      if (plan.removed.length) {
        await tx
          .delete(rolePermissions)
          .where(and(eq(rolePermissions.roleId, plan.role.id), inArray(rolePermissions.permissionKey, plan.removed)));
      }
      if (plan.added.length) {
        await tx.insert(rolePermissions).values(plan.added.map((p) => ({ roleId: plan.role.id, permissionKey: p })));
      }
      await tx
        .update(roles)
        .set({ version: plan.role.version + 1 })
        .where(eq(roles.id, plan.role.id));
      await recordAudit(tx, actor, {
        action: 'roles.setPermissions',
        resourceType: 'role',
        resourceId: plan.role.id,
        outcome: 'success',
        before: { permissions: plan.before },
        after: { permissions: plan.after },
        metadata: { added: plan.added, removed: plan.removed },
      });
    });
    return this.get(actor, id);
  }

  private resolveAssignmentOrg(actor: Actor, role: RoleRow, requested: string | null | undefined): string | null {
    if (!this.deps.features.organizations) return null;
    if (role.scope === 'organization') return role.organizationId ?? actor.organizationId;
    if (requested && requested !== actor.organizationId) throw AppError.forbidden('Solo puedes asignar roles en tu organización activa');
    return requested ?? null;
  }

  async planAssign(actor: Actor, userId: string, roleId: string, organizationId?: string | null, db: DbOrTx = this.deps.db): Promise<AssignmentPlan> {
    assertCan(actor, 'roles.manage');
    const role = await this.findVisible(actor, roleId, db);
    assertCanManageRole(actor, role);
    const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw AppError.notFound('Usuario');
    assertCanManageUser(actor, await targetUserInfo(db, userId), 'cambiar roles de');
    const orgId = this.resolveAssignmentOrg(actor, role, organizationId);
    const [existing] = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, role.id),
          orgId ? eq(userRoles.organizationId, orgId) : isNull(userRoles.organizationId),
        ),
      )
      .limit(1);
    return { userId, userEmail: user.email, role, organizationId: orgId, alreadyAssigned: !!existing };
  }

  async assign(actor: Actor, userId: string, roleId: string, organizationId?: string | null): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      const plan = await this.planAssign(actor, userId, roleId, organizationId, tx);
      if (plan.alreadyAssigned) return;
      await tx.insert(userRoles).values({ userId, roleId: plan.role.id, organizationId: plan.organizationId, assignedBy: actor.userId });
      await recordAudit(tx, actor, {
        action: 'users.assignRole',
        resourceType: 'user',
        resourceId: userId,
        outcome: 'success',
        after: { role: plan.role.key, organizationId: plan.organizationId },
      });
    });
  }

  async planUnassign(actor: Actor, userId: string, roleId: string, organizationId?: string | null, db: DbOrTx = this.deps.db): Promise<AssignmentPlan> {
    const plan = await this.planAssign(actor, userId, roleId, organizationId, db);
    if (!plan.alreadyAssigned) throw AppError.notFound('Asignación de rol');
    if (plan.role.key === 'owner') await assertNotLastOwner(db, await targetUserInfo(db, userId), 'quitar el rol');
    return plan;
  }

  async unassign(actor: Actor, userId: string, roleId: string, organizationId?: string | null): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      // Serialize owner changes to protect the "last owner" invariant under concurrency.
      await tx.execute(sql`select pg_advisory_xact_lock(727002)`);
      const plan = await this.planUnassign(actor, userId, roleId, organizationId, tx);
      await tx
        .delete(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            eq(userRoles.roleId, plan.role.id),
            plan.organizationId ? eq(userRoles.organizationId, plan.organizationId) : isNull(userRoles.organizationId),
          ),
        );
      await recordAudit(tx, actor, {
        action: 'users.removeRole',
        resourceType: 'user',
        resourceId: userId,
        outcome: 'success',
        before: { role: plan.role.key, organizationId: plan.organizationId },
      });
    });
  }
}
