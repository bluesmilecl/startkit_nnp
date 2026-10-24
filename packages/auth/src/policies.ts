import { AppError, isPermissionKey, PERMISSIONS, type PermissionKey } from '@starter/contracts';
import { and, count, eq, isNull, isNotNull, roles, userRoles, users, type DbOrTx } from '@starter/db';
import type { Actor } from './actor.js';

/** Roles at or above the actor's rank, and the owner role, can only be handled by owners. */
export function assertCanManageRole(actor: Actor, role: { key: string; rank: number; organizationId: string | null }): void {
  if (actor.isOwner) return;
  if (role.key === 'owner') throw AppError.forbidden('Solo un propietario puede gestionar el rol propietario');
  if (role.rank >= actor.maxRank) {
    throw AppError.forbidden('No puedes gestionar roles de igual o mayor jerarquía que la tuya');
  }
  if (role.organizationId === null && !actor.platformPermissions.has('roles.manage')) {
    throw AppError.forbidden('Los roles de plataforma requieren privilegios de plataforma');
  }
}

/** Delegable authorization: you can only grant what you hold; sensitive permissions are owner-only. */
export function assertDelegable(actor: Actor, permissionKeys: string[]): PermissionKey[] {
  const unknown = permissionKeys.filter((k) => !isPermissionKey(k));
  if (unknown.length) {
    throw AppError.validation('Permisos inexistentes: el catálogo solo admite operaciones implementadas', { unknown });
  }
  const keys = [...new Set(permissionKeys)] as PermissionKey[];
  if (actor.isOwner) return keys;
  const notHeld = keys.filter((k) => !actor.permissions.has(k));
  if (notHeld.length) throw AppError.forbidden('No puedes conceder permisos que no posees', { notHeld });
  const sensitive = keys.filter((k) => (PERMISSIONS[k] as { sensitive?: boolean }).sensitive);
  if (sensitive.length) throw AppError.forbidden('Los permisos sensibles solo los concede un propietario', { sensitive });
  return keys;
}

export interface TargetUserInfo {
  id: string;
  maxRank: number;
  isOwner: boolean;
}

export async function targetUserInfo(db: DbOrTx, userId: string): Promise<TargetUserInfo> {
  const rows = await db
    .select({ key: roles.key, rank: roles.rank, organizationId: userRoles.organizationId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  return {
    id: userId,
    maxRank: rows.reduce((m, r) => Math.max(m, r.rank), 0),
    isOwner: rows.some((r) => r.key === 'owner' && r.organizationId === null),
  };
}

/** Prevents self-escalation and acting on users with higher privileges. */
export function assertCanManageUser(actor: Actor, target: TargetUserInfo, action: string): void {
  if (target.id === actor.userId) {
    throw AppError.forbidden(`No puedes ${action} tu propia cuenta desde esta operación`);
  }
  if (actor.isOwner) return;
  if (target.isOwner) throw AppError.forbidden('Solo un propietario puede modificar a otro propietario');
  if (target.maxRank >= actor.maxRank) {
    throw AppError.forbidden('No puedes modificar usuarios con jerarquía igual o superior a la tuya');
  }
}

/** Number of active (not disabled) users holding the platform owner role. */
export async function activeOwnerCount(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.key, 'owner'), isNull(roles.organizationId), isNull(userRoles.organizationId), isNull(users.disabledAt)));
  return row?.n ?? 0;
}

export async function assertNotLastOwner(db: DbOrTx, target: TargetUserInfo, operation: string): Promise<void> {
  if (!target.isOwner) return;
  const n = await activeOwnerCount(db);
  if (n <= 1) {
    throw AppError.precondition(`No se puede ${operation}: es el último propietario activo. Asigna otro propietario primero.`);
  }
}

export async function disabledUsersCount(db: DbOrTx): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users).where(isNotNull(users.disabledAt));
  return row?.n ?? 0;
}
