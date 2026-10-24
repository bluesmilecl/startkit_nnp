import { AppError, CreateRoleInput, PERMISSIONS, type PermissionKey } from '@starter/contracts';
import { z } from 'zod';
import { assertCan, type AccessDeps, type Actor } from './actor.js';
import { assertCanManageRole, assertDelegable } from './policies.js';
import type { ProposalExecutor, ProposalPreview } from './proposals.js';
import { RolesService } from './roles.js';
import { UsersService } from './users.js';

const UserIdArgs = z.object({ userId: z.uuid() });
const DisableArgs = UserIdArgs.extend({ reason: z.string().max(500).optional() });
const RoleAssignArgs = z.object({ userId: z.uuid(), roleId: z.uuid(), organizationId: z.uuid().nullable().optional() });
const SetPermsArgs = z.object({ roleId: z.uuid(), permissions: z.array(z.string()).max(200) });
const RoleIdArgs = z.object({ roleId: z.uuid() });

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw AppError.validation('Argumentos inválidos', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  return r.data;
}

const permLabel = (k: string) => `${k} (${(PERMISSIONS as Record<string, { description: string }>)[k]?.description ?? '?'})`;

/** Executors for sensitive administrative actions (shared by chat tools and panel). */
export function createAdminExecutors(deps: AccessDeps): ProposalExecutor[] {
  const usersSvc = new UsersService(deps);
  const rolesSvc = new RolesService(deps);

  const userVersion = async (actor: Actor, userId: string) => usersSvc.version(await usersSvc.findVisible(actor, userId));
  const userHref = (id: string) => `/admin/users/${id}`;

  const deleteUser: ProposalExecutor = {
    action: 'users.delete',
    async preview(actor, raw): Promise<ProposalPreview> {
      const args = parse(UserIdArgs, raw);
      const plan = await usersSvc.planDelete(actor, args.userId);
      return {
        resourceType: 'user',
        resourceId: plan.user.id,
        resourceVersion: await usersSvc.version(plan.user),
        title: `Eliminar usuario ${plan.user.name || plan.user.email}`,
        target: { label: `${plan.user.name} <${plan.user.email}>`, href: userHref(plan.user.id) },
        changes: [
          { field: 'cuenta', before: 'existe', after: 'eliminada' },
          { field: 'roles', before: plan.roles.map((r) => r.name), after: [] },
        ],
        effects: [
          `Se revocan ${plan.sessions} sesión(es) y el acceso inmediatamente`,
          `Se eliminan sus conversaciones y ${plan.attachments} archivo(s) adjunto(s)`,
          'La auditoría y los registros de costo se conservan con identificadores seudónimos',
          'Esta acción no se puede deshacer',
        ],
        args,
      };
    },
    currentVersion: (actor, args) => userVersion(actor, String(args.userId)),
    async execute(actor, args) {
      const result = await usersSvc.delete(actor, String(args.userId));
      return { result, href: '/admin/users' };
    },
  };

  const disableUser: ProposalExecutor = {
    action: 'users.disable',
    async preview(actor, raw) {
      const args = parse(DisableArgs, raw);
      const plan = await usersSvc.planDisable(actor, args.userId);
      if (plan.user.disabledAt) throw AppError.conflict('El usuario ya está desactivado');
      return {
        resourceType: 'user',
        resourceId: plan.user.id,
        resourceVersion: await usersSvc.version(plan.user),
        title: `Desactivar a ${plan.user.name || plan.user.email}`,
        target: { label: `${plan.user.name} <${plan.user.email}>`, href: userHref(plan.user.id) },
        changes: [{ field: 'estado', before: 'activo', after: 'desactivado' }],
        effects: [`Se revocan ${plan.activeSessions} sesión(es) activa(s)`, 'No podrá ingresar hasta ser reactivado'],
        args,
      };
    },
    currentVersion: (actor, args) => userVersion(actor, String(args.userId)),
    async execute(actor, args) {
      const user = await usersSvc.disable(actor, String(args.userId), args.reason as string | undefined);
      return { result: { id: user.id, status: user.status }, href: userHref(user.id) };
    },
  };

  const assignRole: ProposalExecutor = {
    action: 'users.assignRole',
    async preview(actor, raw) {
      const args = parse(RoleAssignArgs, raw);
      const plan = await rolesSvc.planAssign(actor, args.userId, args.roleId, args.organizationId);
      if (plan.alreadyAssigned) throw AppError.conflict(`El usuario ya tiene el rol ${plan.role.name}`);
      const detail = await usersSvc.get(actor, args.userId);
      const before = detail.roles.map((r) => r.name);
      return {
        resourceType: 'user',
        resourceId: args.userId,
        resourceVersion: detail.version,
        title: `Asignar rol ${plan.role.name} a ${detail.name || detail.email}`,
        target: { label: `${detail.name} <${detail.email}>`, href: userHref(args.userId) },
        changes: [{ field: 'roles', before, after: [...before, plan.role.name] }],
        effects: ['Los permisos cambian en la siguiente solicitud del usuario'],
        args: { userId: args.userId, roleId: plan.role.id, organizationId: plan.organizationId },
      };
    },
    currentVersion: (actor, args) => userVersion(actor, String(args.userId)),
    async execute(actor, args) {
      const u = await usersSvc.assignRole(actor, String(args.userId), String(args.roleId), args.organizationId as string | null);
      return { result: { id: u.id, roles: u.roles.map((r) => r.key) }, href: userHref(u.id) };
    },
  };

  const removeRole: ProposalExecutor = {
    action: 'users.removeRole',
    async preview(actor, raw) {
      const args = parse(RoleAssignArgs, raw);
      const plan = await rolesSvc.planUnassign(actor, args.userId, args.roleId, args.organizationId);
      const detail = await usersSvc.get(actor, args.userId);
      const before = detail.roles.map((r) => r.name);
      return {
        resourceType: 'user',
        resourceId: args.userId,
        resourceVersion: detail.version,
        title: `Quitar rol ${plan.role.name} a ${detail.name || detail.email}`,
        target: { label: `${detail.name} <${detail.email}>`, href: userHref(args.userId) },
        changes: [{ field: 'roles', before, after: before.filter((n) => n !== plan.role.name) }],
        effects: ['Pierde los permisos de ese rol en la siguiente solicitud'],
        args: { userId: args.userId, roleId: plan.role.id, organizationId: plan.organizationId },
      };
    },
    currentVersion: (actor, args) => userVersion(actor, String(args.userId)),
    async execute(actor, args) {
      const u = await usersSvc.removeRole(actor, String(args.userId), String(args.roleId), args.organizationId as string | null);
      return { result: { id: u.id, roles: u.roles.map((r) => r.key) }, href: userHref(u.id) };
    },
  };

  /** Changing a user's role = remove all current platform roles + assign the new one (atomic per step). */
  const changeRole: ProposalExecutor = {
    action: 'users.changeRole',
    async preview(actor, raw) {
      const args = parse(RoleAssignArgs, raw);
      const detail = await usersSvc.get(actor, args.userId);
      const plan = await rolesSvc.planAssign(actor, args.userId, args.roleId, args.organizationId);
      const removals = detail.roles.filter((r) => r.id !== plan.role.id && r.organizationId === plan.organizationId);
      for (const r of removals) await rolesSvc.planUnassign(actor, args.userId, r.id, r.organizationId);
      return {
        resourceType: 'user',
        resourceId: args.userId,
        resourceVersion: detail.version,
        title: `Cambiar rol de ${detail.name || detail.email} a ${plan.role.name}`,
        target: { label: `${detail.name} <${detail.email}>`, href: userHref(args.userId) },
        changes: [{ field: 'roles', before: detail.roles.map((r) => r.name), after: [plan.role.name] }],
        effects: ['Los permisos cambian en la siguiente solicitud del usuario'],
        args: { userId: args.userId, roleId: plan.role.id, organizationId: plan.organizationId, remove: removals.map((r) => r.id) },
      };
    },
    currentVersion: (actor, args) => userVersion(actor, String(args.userId)),
    async execute(actor, args) {
      const userId = String(args.userId);
      await usersSvc.assignRole(actor, userId, String(args.roleId), args.organizationId as string | null);
      for (const roleId of (args.remove as string[]) ?? []) {
        await usersSvc.removeRole(actor, userId, roleId, args.organizationId as string | null);
      }
      const u = await usersSvc.get(actor, userId);
      return { result: { id: u.id, roles: u.roles.map((r) => r.key) }, href: userHref(u.id) };
    },
  };

  const setPermissions: ProposalExecutor = {
    action: 'roles.setPermissions',
    async preview(actor, raw) {
      const args = parse(SetPermsArgs, raw);
      const plan = await rolesSvc.planSetPermissions(actor, args.roleId, args.permissions);
      if (!plan.added.length && !plan.removed.length) throw AppError.conflict('El rol ya tiene exactamente esos permisos');
      return {
        resourceType: 'role',
        resourceId: plan.role.id,
        resourceVersion: String(plan.role.version),
        title: `Cambiar permisos del rol ${plan.role.name}`,
        target: { label: plan.role.name, href: `/admin/roles/${plan.role.id}` },
        changes: [
          ...plan.added.map((p) => ({ field: permLabel(p), before: false, after: true })),
          ...plan.removed.map((p) => ({ field: permLabel(p), before: true, after: false })),
        ],
        effects: ['Afecta a todos los usuarios con este rol en su siguiente solicitud'],
        args: { roleId: plan.role.id, permissions: plan.after },
      };
    },
    async currentVersion(actor, args) {
      const role = await rolesSvc.findVisible(actor, String(args.roleId));
      return String(role.version);
    },
    async execute(actor, args) {
      const role = await rolesSvc.setPermissions(actor, String(args.roleId), args.permissions as PermissionKey[]);
      return { result: { id: role.id, permissions: role.permissions }, href: `/admin/roles/${role.id}` };
    },
  };

  const deleteRole: ProposalExecutor = {
    action: 'roles.delete',
    async preview(actor, raw) {
      const args = parse(RoleIdArgs, raw);
      const { role, assignedUsers } = await rolesSvc.planDelete(actor, args.roleId);
      if (assignedUsers > 0) throw AppError.conflict(`El rol tiene ${assignedUsers} usuario(s) asignado(s); quítalos primero`);
      return {
        resourceType: 'role',
        resourceId: role.id,
        resourceVersion: String(role.version),
        title: `Eliminar rol ${role.name}`,
        target: { label: role.name, href: `/admin/roles/${role.id}` },
        changes: [{ field: 'rol', before: role.name, after: 'eliminado' }],
        effects: ['Esta acción no se puede deshacer'],
        args,
      };
    },
    async currentVersion(actor, args) {
      return String((await rolesSvc.findVisible(actor, String(args.roleId))).version);
    },
    async execute(actor, args) {
      await rolesSvc.delete(actor, String(args.roleId));
      return { result: { deleted: true }, href: '/admin/roles' };
    },
  };

  const createRole: ProposalExecutor = {
    action: 'roles.create',
    async preview(actor, raw) {
      const args = parse(CreateRoleInput, raw);
      // Dry-run of the same checks performed by RolesService.create
      assertCan(actor, 'roles.manage');
      if (args.permissions.length) assertCan(actor, 'permissions.manage');
      assertCanManageRole(actor, { key: args.key, rank: args.rank, organizationId: null });
      assertDelegable(actor, args.permissions);
      return {
        resourceType: 'role',
        resourceId: null,
        resourceVersion: null,
        title: `Crear rol ${args.name}`,
        target: { label: `${args.name} (${args.key})`, href: null },
        changes: [
          { field: 'jerarquía', before: null, after: args.rank },
          ...args.permissions.map((p) => ({ field: permLabel(p), before: false, after: true })),
        ],
        effects: ['El rol queda disponible para asignación'],
        args: args as unknown as Record<string, unknown>,
      };
    },
    currentVersion: async () => null,
    async execute(actor, args) {
      const role = await rolesSvc.create(actor, parse(CreateRoleInput, args));
      return { result: { id: role.id, key: role.key }, href: `/admin/roles/${role.id}` };
    },
  };

  return [deleteUser, disableUser, assignRole, removeRole, changeRole, setPermissions, deleteRole, createRole];
}
