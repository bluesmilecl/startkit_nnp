import { PERMISSION_KEYS, PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from '@starter/contracts';
import { and, eq, inArray, isNull, notInArray, permissions, rolePermissions, roles, sql, type Database } from '@starter/db';

/**
 * Synchronizes the implemented permission catalog and the system roles.
 * - New permissions are inserted; removed ones are marked deprecated (they grant nothing).
 * - System roles are created with default permissions the first time only, so local
 *   customizations survive upgrades. The owner role always holds the full catalog.
 */
export async function syncAccessCatalog(db: Database): Promise<{ permissions: number; createdRoles: string[] }> {
  return db.transaction(async (tx) => {
    // Keys never seen before (new module or new feature): their default grants are applied to
    // existing system roles below. Keys already known keep whatever administrators configured.
    const known = new Set((await tx.select({ key: permissions.key }).from(permissions)).map((r) => r.key));
    const introduced = PERMISSION_KEYS.filter((k) => !known.has(k));
    for (const key of PERMISSION_KEYS) {
      const def = PERMISSIONS[key] as { group: string; description: string; sensitive?: boolean };
      await tx
        .insert(permissions)
        .values({ key, group: def.group, description: def.description, sensitive: def.sensitive ?? false, source: 'core' })
        .onConflictDoUpdate({
          target: permissions.key,
          set: { group: def.group, description: def.description, sensitive: def.sensitive ?? false, deprecatedAt: null },
        });
    }
    await tx
      .update(permissions)
      .set({ deprecatedAt: sql`now()` })
      .where(and(notInArray(permissions.key, PERMISSION_KEYS), isNull(permissions.deprecatedAt)));

    const createdRoles: string[] = [];
    for (const key of Object.keys(SYSTEM_ROLES) as SystemRoleKey[]) {
      const def = SYSTEM_ROLES[key];
      const [existing] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.key, key), isNull(roles.organizationId)))
        .limit(1);
      let roleId = existing?.id;
      if (!roleId) {
        const [created] = await tx
          .insert(roles)
          .values({ key, name: def.name, description: def.description, rank: def.rank, isSystem: true, scope: 'platform' })
          .returning({ id: roles.id });
        roleId = created!.id;
        createdRoles.push(key);
        const perms = SYSTEM_ROLE_PERMISSIONS[key];
        if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ roleId: roleId!, permissionKey: p })));
      } else if (known.size && introduced.length) {
        const grants = SYSTEM_ROLE_PERMISSIONS[key].filter((p) => introduced.includes(p));
        if (grants.length) await tx.insert(rolePermissions).values(grants.map((p) => ({ roleId: roleId!, permissionKey: p }))).onConflictDoNothing();
      }
      if (key === 'owner') {
        await tx
          .insert(rolePermissions)
          .values(PERMISSION_KEYS.map((p: PermissionKey) => ({ roleId: roleId!, permissionKey: p })))
          .onConflictDoNothing();
      }
    }
    return { permissions: PERMISSION_KEYS.length, createdRoles };
  });
}

export async function systemRoleId(db: Database, key: SystemRoleKey): Promise<string> {
  const [row] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.key, key), isNull(roles.organizationId)))
    .limit(1);
  if (!row) throw new Error(`System role ${key} missing; run migrations/seed`);
  return row.id;
}

export async function roleIdsByKey(db: Database, keys: string[]): Promise<Map<string, string>> {
  if (!keys.length) return new Map();
  const rows = await db
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(inArray(roles.key, keys), isNull(roles.organizationId)));
  return new Map(rows.map((r) => [r.key, r.id]));
}
