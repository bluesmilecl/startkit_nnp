import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_helpers.js';
import { users } from './auth.js';

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /** The internal workspace used when the organizations module is disabled. */
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: ts('archived_at'),
});

export const memberships = pgTable(
  'memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.organizationId] }), index('memberships_org_idx').on(t.organizationId)],
);

/**
 * Role definitions. scope=platform roles are assigned without organization (platform privileges);
 * scope=organization roles are assigned per membership when the organizations module is active.
 */
export const roles = pgTable(
  'roles',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    scope: text('scope', { enum: ['platform', 'organization'] })
      .notNull()
      .default('platform'),
    /** System roles cannot be deleted; owner permissions are immutable. */
    isSystem: boolean('is_system').notNull().default(false),
    /** Ordering used to prevent assigning roles above the actor's highest rank. */
    rank: integer('rank').notNull().default(50),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    /** Incremented on every change; used by action proposals to detect stale previews. */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('roles_key_org_uq').on(t.key, t.organizationId).nullsNotDistinct()],
);

/** Catalog of implemented permissions, synchronized from code on boot. */
export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  group: text('group').notNull(),
  description: text('description').notNull(),
  /** Permissions only grantable by owners (e.g. roles.manage on system roles). */
  sensitive: boolean('sensitive').notNull().default(false),
  /** Registered by an extension module instead of the core. */
  source: text('source').notNull().default('core'),
  deprecatedAt: ts('deprecated_at'),
  createdAt: createdAt(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    /** NULL = platform-level assignment. */
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('user_roles_uq').on(t.userId, t.roleId, t.organizationId).nullsNotDistinct(),
    index('user_roles_role_idx').on(t.roleId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    email: text('email').notNull(),
    roleId: uuid('role_id').references(() => roles.id, { onDelete: 'set null' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    invitedBy: uuid('invited_by'),
    /** bootstrap = owner pre-assignment performed by the installer (trusted procedure). */
    kind: text('kind', { enum: ['invite', 'bootstrap'] })
      .notNull()
      .default('invite'),
    status: text('status', { enum: ['pending', 'accepted', 'revoked', 'expired'] })
      .notNull()
      .default('pending'),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    acceptedUserId: uuid('accepted_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('invitations_email_idx').on(sql`lower(${t.email})`),
    index('invitations_status_idx').on(t.status, t.expiresAt),
  ],
);

/** Installation (organization_id NULL) or organization scoped settings. */
export const settings = pgTable(
  'settings',
  {
    id: id(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [unique('settings_scope_key_uq').on(t.organizationId, t.key).nullsNotDistinct()],
);
