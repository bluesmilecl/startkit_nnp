import type { Env, FeatureFlags } from '@starter/config';
import { AppError, isPermissionKey, PERMISSION_KEYS, type PermissionKey } from '@starter/contracts';
import {
  and,
  DEFAULT_ORGANIZATION_ID,
  eq,
  inArray,
  isNull,
  memberships,
  or,
  organizations,
  rolePermissions,
  roles,
  userRoles,
  users,
  type Database,
} from '@starter/db';
import type { Mailer } from '@starter/mail';

/** Channel through which the actor is acting. Chat actions carry agent context for audit. */
export type ActorChannel = 'panel' | 'api' | 'chat' | 'cli' | 'system';

export interface AgentContext {
  agentId: string;
  conversationId?: string | null;
  toolCallId?: string | null;
  aiRequestId?: string | null;
}

export interface ActorRole {
  id: string;
  key: string;
  name: string;
  rank: number;
  organizationId: string | null;
}

export interface Actor {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationIds: string[];
  roles: ActorRole[];
  /** Effective permissions in the active organization (platform + organization roles). */
  permissions: ReadonlySet<PermissionKey>;
  /** Permissions granted by platform-level roles only (global scope, e.g. all users). */
  platformPermissions: ReadonlySet<PermissionKey>;
  maxRank: number;
  isOwner: boolean;
  channel: ActorChannel;
  sessionId?: string;
  requestId?: string;
  ip?: string | null;
  userAgent?: string | null;
  agent?: AgentContext;
}

/** Shared dependencies of the access services (REST, CLI, worker and chat tools). */
export interface AccessDeps {
  db: Database;
  env: Env;
  features: FeatureFlags;
  mailer: Mailer;
  /** Receives access domain events (user deleted → purge files, ...). */
  onEvent?: (event: import('./users.js').AccessEvent) => Promise<void> | void;
}

export interface LoadActorInput {
  userId: string;
  organizationId?: string | null;
  channel: ActorChannel;
  sessionId?: string;
  requestId?: string;
  ip?: string | null;
  userAgent?: string | null;
  agent?: AgentContext;
}

/**
 * Loads the actor from the database on every call: permission changes and revocations take
 * effect on the next request/tool execution (no permission cache to invalidate).
 */
export async function loadActor(deps: Pick<AccessDeps, 'db' | 'features'>, input: LoadActorInput): Promise<Actor> {
  const { db, features } = deps;
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) throw new AppError('UNAUTHENTICATED', 'Sesión inválida');
  if (user.disabledAt) throw new AppError('FORBIDDEN', 'La cuenta está desactivada');

  const orgRows = await db
    .select({ id: organizations.id, isDefault: organizations.isDefault })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, user.id), isNull(organizations.archivedAt)));
  let organizationIds = orgRows.map((o) => o.id);

  let organizationId: string;
  if (!features.organizations) {
    organizationId = DEFAULT_ORGANIZATION_ID;
    if (!organizationIds.includes(DEFAULT_ORGANIZATION_ID)) {
      await db.insert(memberships).values({ userId: user.id, organizationId: DEFAULT_ORGANIZATION_ID }).onConflictDoNothing();
      organizationIds = [...organizationIds, DEFAULT_ORGANIZATION_ID];
    }
  } else if (input.organizationId && organizationIds.includes(input.organizationId)) {
    organizationId = input.organizationId;
  } else {
    organizationId = orgRows.find((o) => o.isDefault)?.id ?? organizationIds[0] ?? DEFAULT_ORGANIZATION_ID;
  }

  const roleRows = await db
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      rank: roles.rank,
      organizationId: userRoles.organizationId,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(userRoles.userId, user.id),
        or(isNull(userRoles.organizationId), eq(userRoles.organizationId, organizationId)),
      ),
    );

  const roleIds = roleRows.map((r) => r.id);
  const permRows = roleIds.length
    ? await db
        .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, roleIds))
    : [];

  const isOwner = roleRows.some((r) => r.key === 'owner' && r.organizationId === null);
  const platformRoleIds = new Set(roleRows.filter((r) => r.organizationId === null).map((r) => r.id));
  const permissions = new Set<PermissionKey>();
  const platformPermissions = new Set<PermissionKey>();
  for (const p of permRows) {
    if (!isPermissionKey(p.key)) continue;
    permissions.add(p.key);
    if (platformRoleIds.has(p.roleId)) platformPermissions.add(p.key);
  }
  if (isOwner) {
    // The owner role is immutable and always holds the full catalog.
    for (const k of PERMISSION_KEYS) {
      permissions.add(k);
      platformPermissions.add(k);
    }
  }
  // Without membership in the active organization only platform permissions apply.
  const member = organizationIds.includes(organizationId);

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId,
    organizationIds,
    roles: roleRows,
    permissions: member ? permissions : platformPermissions,
    platformPermissions,
    maxRank: roleRows.reduce((m, r) => Math.max(m, r.rank), 0),
    isOwner,
    channel: input.channel,
    sessionId: input.sessionId,
    requestId: input.requestId,
    ip: input.ip,
    userAgent: input.userAgent,
    agent: input.agent,
  };
}

/** System actor used by bootstrap/maintenance code (never exposed to requests). */
export function systemActor(organizationId = DEFAULT_ORGANIZATION_ID): Actor {
  const all = new Set(PERMISSION_KEYS);
  return {
    userId: '00000000-0000-4000-8000-000000000000',
    email: 'system@localhost',
    name: 'Sistema',
    organizationId,
    organizationIds: [organizationId],
    roles: [],
    permissions: all,
    platformPermissions: all,
    maxRank: 1000,
    isOwner: true,
    channel: 'system',
  };
}

export function can(actor: Actor, permission: PermissionKey): boolean {
  return actor.permissions.has(permission);
}

export function assertCan(actor: Actor, ...required: PermissionKey[]): void {
  const missing = required.filter((p) => !actor.permissions.has(p));
  if (missing.length) throw AppError.forbidden(`Permiso requerido: ${missing.join(', ')}`, { missing });
}

/** Organization ownership check for org-scoped resources. */
export function assertSameOrganization(actor: Actor, organizationId: string | null | undefined, what = 'Recurso'): void {
  if (!organizationId || organizationId !== actor.organizationId) throw AppError.notFound(what);
}
