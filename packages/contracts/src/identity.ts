import { z } from 'zod';
import { IsoDate, PageQuery, pageOf, Uuid } from './common.js';

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));

export const FeatureFlags = z
  .object({ organizations: z.boolean(), ai: z.boolean(), rag: z.boolean() })
  .meta({ id: 'FeatureFlags' });

export const OrganizationRef = z
  .object({ id: Uuid, name: z.string(), slug: z.string(), isDefault: z.boolean() })
  .meta({ id: 'OrganizationRef' });

export const RoleRef = z
  .object({
    id: Uuid,
    key: z.string(),
    name: z.string(),
    organizationId: Uuid.nullable().meta({ description: 'null = platform-level assignment' }),
  })
  .meta({ id: 'RoleRef' });

export const Me = z
  .object({
    user: z.object({
      id: Uuid,
      email: z.string(),
      name: z.string(),
      image: z.string().nullable(),
      locale: z.string().nullable(),
      timezone: z.string().nullable(),
    }),
    organization: OrganizationRef,
    organizations: z.array(OrganizationRef),
    roles: z.array(RoleRef),
    permissions: z.array(z.string()),
    features: FeatureFlags,
    onboardingRequired: z.boolean(),
  })
  .meta({ id: 'Me' });
export type Me = z.infer<typeof Me>;

export const UpdateProfileInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    locale: z.string().max(20).nullable().optional(),
    timezone: z.string().max(60).nullable().optional(),
  })
  .meta({ id: 'UpdateProfileInput' });

export const UserStatus = z.enum(['active', 'disabled', 'pending']).meta({ id: 'UserStatus' });

export const UserSummary = z
  .object({
    id: Uuid,
    email: z.string(),
    name: z.string(),
    image: z.string().nullable(),
    emailVerified: z.boolean(),
    status: UserStatus,
    roles: z.array(RoleRef),
    createdAt: IsoDate,
    lastLoginAt: IsoDate.nullable(),
    disabledAt: IsoDate.nullable(),
  })
  .meta({ id: 'UserSummary' });
export type UserSummary = z.infer<typeof UserSummary>;

export const SessionSummary = z
  .object({
    id: Uuid,
    createdAt: IsoDate,
    expiresAt: IsoDate,
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    current: z.boolean(),
  })
  .meta({ id: 'SessionSummary' });

export const UserDetail = UserSummary.extend({
  locale: z.string().nullable(),
  timezone: z.string().nullable(),
  disabledReason: z.string().nullable(),
  updatedAt: IsoDate,
  organizations: z.array(OrganizationRef),
  sessionCount: z.number().int(),
  version: z.string().meta({ description: 'Opaque version used for optimistic concurrency' }),
}).meta({ id: 'UserDetail' });
export type UserDetail = z.infer<typeof UserDetail>;

export const UsersListQuery = PageQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: UserStatus.optional(),
  roleId: Uuid.optional(),
  sort: z.enum(['createdAt', 'name', 'email', 'lastLoginAt']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type UsersListQuery = z.infer<typeof UsersListQuery>;

export const UsersPage = pageOf(UserSummary, 'UsersPage');

export const CreateUserInput = z
  .object({
    email: Email,
    name: z.string().trim().min(1).max(120),
    roleIds: z.array(Uuid).max(10).default([]),
    sendInvitation: z.boolean().default(true),
  })
  .meta({ id: 'CreateUserInput' });
export type CreateUserInput = z.infer<typeof CreateUserInput>;

export const UpdateUserInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    locale: z.string().max(20).nullable().optional(),
    timezone: z.string().max(60).nullable().optional(),
  })
  .meta({ id: 'UpdateUserInput' });
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

export const DisableUserInput = z
  .object({ reason: z.string().trim().max(500).optional() })
  .meta({ id: 'DisableUserInput' });

export const AssignRoleInput = z
  .object({ roleId: Uuid, organizationId: Uuid.nullable().optional() })
  .meta({ id: 'AssignRoleInput' });
export type AssignRoleInput = z.infer<typeof AssignRoleInput>;

export const Permission = z
  .object({
    key: z.string(),
    group: z.string(),
    description: z.string(),
    sensitive: z.boolean(),
    source: z.string(),
  })
  .meta({ id: 'Permission' });

export const RoleSummary = z
  .object({
    id: Uuid,
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    scope: z.enum(['platform', 'organization']),
    isSystem: z.boolean(),
    rank: z.number().int(),
    organizationId: Uuid.nullable(),
    userCount: z.number().int(),
    permissionCount: z.number().int(),
    version: z.number().int(),
  })
  .meta({ id: 'RoleSummary' });
export type RoleSummary = z.infer<typeof RoleSummary>;

export const RoleDetail = RoleSummary.extend({ permissions: z.array(z.string()), editable: z.boolean() }).meta({
  id: 'RoleDetail',
});
export type RoleDetail = z.infer<typeof RoleDetail>;

export const RoleKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_-]{1,40}$/, 'lowercase letters, numbers, - or _');

export const CreateRoleInput = z
  .object({
    key: RoleKey,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    rank: z.number().int().min(1).max(99).default(40),
    scope: z.enum(['platform', 'organization']).default('platform'),
    permissions: z.array(z.string()).max(200).default([]),
  })
  .meta({ id: 'CreateRoleInput' });
export type CreateRoleInput = z.infer<typeof CreateRoleInput>;

export const UpdateRoleInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    rank: z.number().int().min(1).max(99).optional(),
    expectedVersion: z.number().int().optional(),
  })
  .meta({ id: 'UpdateRoleInput' });
export type UpdateRoleInput = z.infer<typeof UpdateRoleInput>;

export const SetRolePermissionsInput = z
  .object({ permissions: z.array(z.string()).max(200), expectedVersion: z.number().int().optional() })
  .meta({ id: 'SetRolePermissionsInput' });

export const PermissionMatrix = z
  .object({
    permissions: z.array(Permission),
    roles: z.array(RoleDetail),
  })
  .meta({ id: 'PermissionMatrix' });

export const InvitationSummary = z
  .object({
    id: Uuid,
    email: z.string(),
    role: RoleRef.nullable(),
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    kind: z.enum(['invite', 'bootstrap']),
    invitedBy: Uuid.nullable(),
    expiresAt: IsoDate,
    createdAt: IsoDate,
    acceptedAt: IsoDate.nullable(),
  })
  .meta({ id: 'InvitationSummary' });

export const InvitationsPage = pageOf(InvitationSummary, 'InvitationsPage');

export const CreateInvitationInput = z
  .object({ email: Email, roleId: Uuid.optional(), expiresInDays: z.number().int().min(1).max(60).default(7) })
  .meta({ id: 'CreateInvitationInput' });
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;

export const OrganizationSummary = OrganizationRef.extend({
  memberCount: z.number().int(),
  createdAt: IsoDate,
  archivedAt: IsoDate.nullable(),
}).meta({ id: 'OrganizationSummary' });

export const CreateOrganizationInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  })
  .meta({ id: 'CreateOrganizationInput' });

export const AddMemberInput = z.object({ userId: Uuid, roleId: Uuid.optional() }).meta({ id: 'AddMemberInput' });

export const SwitchOrganizationInput = z.object({ organizationId: Uuid }).meta({ id: 'SwitchOrganizationInput' });
