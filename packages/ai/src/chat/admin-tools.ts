import { RolesService, UsersService, type AccessDeps, type Actor, type ProposalsService, type UserCandidate } from '@starter/auth';
import { ADMIN_TOOLS, isAppError, PERMISSION_KEYS, type AdminToolKey } from '@starter/contracts';
import { toolExecutions, type Database } from '@starter/db';
import { sanitizeError } from '@starter/observability';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

export interface ToolContext {
  actor: Actor;
  db: Database;
  access: AccessDeps;
  proposals: ProposalsService;
  agentId: string;
  conversationId: string | null;
  aiRequestId: string | null;
}

const UserRef = z.string().trim().min(1).max(200).describe('Correo exacto (preferido), nombre o id de la persona');
const RoleRef = z.string().trim().min(1).max(80).describe('Clave del rol (p. ej. editor) o su nombre');

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

type Resolved<T> = { ok: true; value: T } | { ok: false; output: Record<string, unknown> };

/**
 * Chat tools for user/role/permission administration. They call the same domain services as the
 * panel and REST API with the actor injected here (never from model arguments), so permission
 * checks, hierarchy, last-owner protection and audit are identical. Sensitive changes return a
 * stored proposal: the model cannot confirm it; only the person, from the interface, can.
 */
export function buildAdminTools(ctx: ToolContext, enabled: AdminToolKey[]): ToolSet {
  const usersSvc = new UsersService(ctx.access);
  const rolesSvc = new RolesService(ctx.access);
  const actor = ctx.actor;

  const resolveUser = async (term: string): Promise<Resolved<UserCandidate>> => {
    const t = term.trim();
    const candidates = /^[0-9a-f-]{36}$/i.test(t)
      ? await usersSvc.get(actor, t).then((u) => [{ id: u.id, email: u.email, name: u.name, status: u.status }]).catch(() => [])
      : await usersSvc.resolve(actor, t, 6);
    if (!candidates.length) return { ok: false, output: { status: 'not_found', query: t } };
    const exact = candidates.filter((c) => c.email.toLowerCase() === t.toLowerCase() || norm(c.name) === norm(t));
    if (exact.length === 1) return { ok: true, value: exact[0]! };
    if (candidates.length === 1) return { ok: true, value: candidates[0]! };
    return { ok: false, output: { status: 'ambiguous', query: t, candidates: candidates.map((c) => ({ name: c.name, email: c.email, status: c.status })) } };
  };

  const resolveRole = async (term: string): Promise<Resolved<{ id: string; key: string; name: string }>> => {
    const roles = await rolesSvc.list(actor);
    const t = norm(term);
    const match = roles.filter((r) => norm(r.key) === t || norm(r.name) === t || r.id === term);
    if (match.length === 1) return { ok: true, value: { id: match[0]!.id, key: match[0]!.key, name: match[0]!.name } };
    return { ok: false, output: { status: 'role_not_found', query: term, available: roles.map((r) => ({ key: r.key, name: r.name })) } };
  };

  /** Wraps a tool body: authorization errors become data for the model; every call is recorded. */
  const run = <I>(name: AdminToolKey, body: (input: I, toolCallId: string) => Promise<Record<string, unknown>>) =>
    async (input: I, opts: { toolCallId: string }) => {
      const started = new Date();
      let output: Record<string, unknown>;
      let status = 'succeeded';
      try {
        output = await body(input, opts.toolCallId);
        if (output.status === 'needs_confirmation') status = 'proposed';
      } catch (err) {
        status = isAppError(err) && err.code === 'FORBIDDEN' ? 'denied' : 'failed';
        output = { error: { code: isAppError(err) ? err.code : 'INTERNAL', message: isAppError(err) ? err.message : sanitizeError(err, 200) } };
      }
      await ctx.db
        .insert(toolExecutions)
        .values({
          organizationId: actor.organizationId,
          conversationId: ctx.conversationId,
          aiRequestId: ctx.aiRequestId,
          agentId: ctx.agentId,
          actorUserId: actor.userId,
          toolCallId: opts.toolCallId,
          toolName: name,
          input: input as Record<string, unknown>,
          output,
          status,
          proposalId: ((output.proposal as { id?: string } | undefined)?.id as string | undefined) ?? null,
          startedAt: started,
          finishedAt: new Date(),
          error: status === 'failed' || status === 'denied' ? String((output.error as { message?: string }).message) : null,
        })
        .onConflictDoNothing();
      return output;
    };

  const propose = async (action: string, args: Record<string, unknown>, toolCallId: string) => {
    const proposal = await ctx.proposals.propose(actor, action, args, { source: 'chat', agentId: ctx.agentId, conversationId: ctx.conversationId, toolCallId });
    return { status: 'needs_confirmation', proposal, note: 'Pendiente de confirmación por la persona en la interfaz. No se ha aplicado ningún cambio.' };
  };

  const brief = (u: { id: string; name: string; email: string; status: string; roles?: { name: string; key: string }[] }) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    roles: u.roles?.map((r) => r.key),
  });

  const all = {
    users_list: tool({
      description: 'Lista usuarios con filtros opcionales (búsqueda por nombre/correo, estado, rol). Devuelve como máximo 25.',
      inputSchema: z.object({
        search: z.string().max(100).optional(),
        status: z.enum(['active', 'disabled', 'pending']).optional(),
        role: RoleRef.optional(),
      }),
      execute: run('users_list', async (input: { search?: string; status?: 'active' | 'disabled' | 'pending'; role?: string }) => {
        let roleId: string | undefined;
        if (input.role) {
          const r = await resolveRole(input.role);
          if (!r.ok) return r.output;
          roleId = r.value.id;
        }
        const page = await usersSvc.list(actor, { page: 1, pageSize: 25, search: input.search, status: input.status, roleId, sort: 'name', direction: 'asc' });
        return { total: page.total, items: page.items.map(brief), href: '/admin/users' };
      }),
    }),
    users_get: tool({
      description: 'Muestra el detalle de una persona (estado, roles, último ingreso).',
      inputSchema: z.object({ user: UserRef }),
      execute: run('users_get', async (input: { user: string }) => {
        const r = await resolveUser(input.user);
        if (!r.ok) return r.output;
        const u = await usersSvc.get(actor, r.value.id);
        return { user: { ...brief(u), lastLoginAt: u.lastLoginAt, createdAt: u.createdAt }, href: `/admin/users/${u.id}` };
      }),
    }),
    users_create: tool({
      description: 'Crea una cuenta. Si se indica un rol, la asignación queda como propuesta a confirmar.',
      inputSchema: z.object({ name: z.string().trim().min(1).max(120), email: z.email(), role: RoleRef.nullable().optional(), sendInvitation: z.boolean().optional() }),
      execute: run('users_create', async (input: { name: string; email: string; role?: string | null; sendInvitation?: boolean }, toolCallId) => {
        let role: { id: string; key: string; name: string } | null = null;
        if (input.role) {
          const r = await resolveRole(input.role);
          if (!r.ok) return r.output;
          role = r.value;
        }
        const u = await usersSvc.create(actor, { name: input.name, email: input.email, roleIds: [], sendInvitation: !!input.sendInvitation && actor.permissions.has('users.invite') });
        if (!role) return { user: brief(u), created: true, href: `/admin/users/${u.id}` };
        const p = await propose('users.assignRole', { userId: u.id, roleId: role.id }, toolCallId);
        return { ...p, user: brief(u), created: true };
      }),
    }),
    users_update: tool({
      description: 'Cambia el nombre visible de una persona.',
      inputSchema: z.object({ user: UserRef, name: z.string().trim().min(1).max(120) }),
      execute: run('users_update', async (input: { user: string; name: string }) => {
        const r = await resolveUser(input.user);
        if (!r.ok) return r.output;
        const u = await usersSvc.update(actor, r.value.id, { name: input.name });
        return { user: brief(u), href: `/admin/users/${u.id}` };
      }),
    }),
    users_enable: tool({
      description: 'Reactiva una cuenta desactivada.',
      inputSchema: z.object({ user: UserRef }),
      execute: run('users_enable', async (input: { user: string }) => {
        const r = await resolveUser(input.user);
        if (!r.ok) return r.output;
        const u = await usersSvc.enable(actor, r.value.id);
        return { user: brief(u), href: `/admin/users/${u.id}` };
      }),
    }),
    users_disable: tool({
      description: 'Prepara la desactivación de una cuenta (requiere confirmación de la persona).',
      inputSchema: z.object({ user: UserRef, reason: z.string().max(500).optional() }),
      execute: run('users_disable', async (input: { user: string; reason?: string }, toolCallId) => {
        const r = await resolveUser(input.user);
        if (!r.ok) return r.output;
        return propose('users.disable', { userId: r.value.id, reason: input.reason }, toolCallId);
      }),
    }),
    users_delete: tool({
      description: 'Prepara la eliminación definitiva de una cuenta (requiere confirmación).',
      inputSchema: z.object({ user: UserRef }),
      execute: run('users_delete', async (input: { user: string }, toolCallId) => {
        const r = await resolveUser(input.user);
        if (!r.ok) return r.output;
        return propose('users.delete', { userId: r.value.id }, toolCallId);
      }),
    }),
    users_changeRole: tool({
      description: 'Prepara el reemplazo de los roles de una persona por uno nuevo (requiere confirmación).',
      inputSchema: z.object({ user: UserRef, role: RoleRef }),
      execute: run('users_changeRole', async (input: { user: string; role: string }, toolCallId) => {
        const r = await resolveUser(input.user);
        if (!r.ok) return r.output;
        const role = await resolveRole(input.role);
        if (!role.ok) return role.output;
        return propose('users.changeRole', { userId: r.value.id, roleId: role.value.id }, toolCallId);
      }),
    }),
    users_assignRole: tool({
      description: 'Prepara la asignación de un rol adicional (requiere confirmación).',
      inputSchema: z.object({ user: UserRef, role: RoleRef }),
      execute: run('users_assignRole', async (input: { user: string; role: string }, toolCallId) => {
        const r = await resolveUser(input.user);
        if (!r.ok) return r.output;
        const role = await resolveRole(input.role);
        if (!role.ok) return role.output;
        return propose('users.assignRole', { userId: r.value.id, roleId: role.value.id }, toolCallId);
      }),
    }),
    users_removeRole: tool({
      description: 'Prepara quitar un rol a una persona (requiere confirmación).',
      inputSchema: z.object({ user: UserRef, role: RoleRef }),
      execute: run('users_removeRole', async (input: { user: string; role: string }, toolCallId) => {
        const r = await resolveUser(input.user);
        if (!r.ok) return r.output;
        const role = await resolveRole(input.role);
        if (!role.ok) return role.output;
        return propose('users.removeRole', { userId: r.value.id, roleId: role.value.id }, toolCallId);
      }),
    }),
    roles_list: tool({
      description: 'Lista los roles visibles con su jerarquía y cantidad de personas.',
      inputSchema: z.object({}),
      execute: run('roles_list', async () => {
        const roles = await rolesSvc.list(actor);
        return { total: roles.length, items: roles.map((r) => ({ key: r.key, name: r.name, rank: r.rank, users: r.userCount, permissions: r.permissionCount, system: r.isSystem })), href: '/admin/roles' };
      }),
    }),
    roles_get: tool({
      description: 'Muestra los permisos de un rol.',
      inputSchema: z.object({ role: RoleRef }),
      execute: run('roles_get', async (input: { role: string }) => {
        const r = await resolveRole(input.role);
        if (!r.ok) return r.output;
        const d = await rolesSvc.get(actor, r.value.id);
        return { role: { key: d.key, name: d.name, rank: d.rank, permissions: d.permissions, editable: d.editable }, href: `/admin/roles/${d.id}` };
      }),
    }),
    roles_create: tool({
      description: 'Prepara la creación de un rol con permisos del catálogo (requiere confirmación).',
      inputSchema: z.object({
        key: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,40}$/),
        name: z.string().trim().min(1).max(80),
        rank: z.number().int().min(1).max(99).optional(),
        permissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])).max(100).optional(),
      }),
      execute: run('roles_create', async (input: { key: string; name: string; rank?: number; permissions?: string[] }, toolCallId) =>
        propose('roles.create', { key: input.key, name: input.name, rank: input.rank ?? 40, scope: 'platform', permissions: input.permissions ?? [] }, toolCallId),
      ),
    }),
    roles_setPermissions: tool({
      description: 'Prepara agregar y/o quitar permisos de un rol (requiere confirmación).',
      inputSchema: z.object({
        role: RoleRef,
        add: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])).max(100).default([]),
        remove: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])).max(100).default([]),
      }),
      execute: run('roles_setPermissions', async (input: { role: string; add?: string[]; remove?: string[] }, toolCallId) => {
        const r = await resolveRole(input.role);
        if (!r.ok) return r.output;
        const current = new Set(await rolesSvc.rolePermissionKeys(r.value.id));
        for (const p of input.add ?? []) current.add(p as never);
        for (const p of input.remove ?? []) current.delete(p as never);
        return propose('roles.setPermissions', { roleId: r.value.id, permissions: [...current] }, toolCallId);
      }),
    }),
    roles_delete: tool({
      description: 'Prepara la eliminación de un rol sin personas asignadas (requiere confirmación).',
      inputSchema: z.object({ role: RoleRef }),
      execute: run('roles_delete', async (input: { role: string }, toolCallId) => {
        const r = await resolveRole(input.role);
        if (!r.ok) return r.output;
        return propose('roles.delete', { roleId: r.value.id }, toolCallId);
      }),
    }),
    permissions_list: tool({
      description: 'Catálogo de permisos implementados, agrupados.',
      inputSchema: z.object({}),
      execute: run('permissions_list', async () => {
        const perms = await rolesSvc.catalog(actor);
        return { total: perms.length, items: perms.map((p) => ({ key: p.key, group: p.group, description: p.description, sensitive: p.sensitive })), href: '/admin/permissions' };
      }),
    }),
  } satisfies Record<AdminToolKey, unknown>;

  // Only tools enabled in the agent AND allowed for this actor are exposed to the model.
  const out: ToolSet = {};
  for (const key of enabled) if (actor.permissions.has(ADMIN_TOOLS[key].permission)) out[key] = all[key] as ToolSet[string];
  return out;
}
