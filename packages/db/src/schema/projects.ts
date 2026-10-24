import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_helpers.js';
import { organizations } from './access.js';

/** Reference business module ("Proyectos") used as the template for `starter generate module`. */
export const projects = pgTable(
  'projects',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    createdBy: uuid('created_by'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    index('projects_org_idx').on(t.organizationId, t.createdAt),
    // Names are unique per organization ignoring case; the service maps the violation to a field error.
    uniqueIndex('projects_org_name_uq').on(t.organizationId, sql`lower(${t.name})`),
  ],
);
