import { z } from 'zod';
import { IsoDate, PageQuery, SortDirection, Uuid, pageOf } from './common.js';

/**
 * Reference business module ("Proyectos"). `starter generate module` copies this contract, the
 * table, the API module, the page and the E2E test, renaming the entity.
 */
export const ProjectStatus = z.enum(['active', 'archived']).meta({ id: 'ProjectStatus' });

export const Project = z
  .object({
    id: Uuid,
    name: z.string(),
    description: z.string().nullable(),
    status: ProjectStatus,
    version: z.number().int().meta({ description: 'Optimistic concurrency token; send it back when updating' }),
    createdBy: z.object({ id: Uuid, name: z.string().nullable(), email: z.string() }).nullable(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
    archivedAt: IsoDate.nullable(),
  })
  .meta({ id: 'Project' });
export type Project = z.infer<typeof Project>;

export const ProjectsQuery = PageQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: ProjectStatus.optional(),
  sort: z.enum(['name', 'createdAt', 'updatedAt']).default('updatedAt'),
  direction: SortDirection.default('desc'),
});
export type ProjectsQuery = z.infer<typeof ProjectsQuery>;
export const ProjectsPage = pageOf(Project, 'ProjectsPage');

export const CreateProjectInput = z
  .object({
    name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .meta({ id: 'CreateProjectInput' });
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const UpdateProjectInput = z
  .object({
    name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    status: ProjectStatus.optional(),
    version: z.number().int().min(1).meta({ description: 'Current version (from the last read); a mismatch returns 412' }),
  })
  .meta({ id: 'UpdateProjectInput' });
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;
