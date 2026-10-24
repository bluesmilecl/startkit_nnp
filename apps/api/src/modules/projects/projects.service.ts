import { Inject, Injectable } from '@nestjs/common';
import { assertCan, recordAudit, type Actor } from '@starter/auth';
import { AppError, type CreateProjectInput, type Project, type ProjectsQuery, type UpdateProjectInput } from '@starter/contracts';
import { and, asc, count, desc, eq, ilike, likeTerm, normalizePage, offsetOf, or, projects, sql, toPage, users, type DbHandle } from '@starter/db';
import { DB } from '../../infra/tokens.js';

type ProjectRow = typeof projects.$inferSelect;

/**
 * Reference business module: organization-scoped CRUD with permission checks, audit,
 * optimistic concurrency (version) and server-side search, sort and pagination.
 */
@Injectable()
export class ProjectsService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  private toDto(p: ProjectRow, creator: { id: string; name: string | null; email: string } | null): Project {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      version: p.version,
      createdBy: creator,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      archivedAt: p.archivedAt?.toISOString() ?? null,
    };
  }

  private select() {
    return this.db.select({ p: projects, u: { id: users.id, name: users.name, email: users.email } }).from(projects).leftJoin(users, eq(users.id, projects.createdBy));
  }

  private async load(actor: Actor, id: string): Promise<Project> {
    const [row] = await this.select().where(and(eq(projects.id, id), eq(projects.organizationId, actor.organizationId)));
    if (!row) throw AppError.notFound('Proyecto');
    return this.toDto(row.p, row.u?.id ? row.u : null);
  }

  async list(actor: Actor, q: ProjectsQuery) {
    assertCan(actor, 'projects.read');
    const params = normalizePage(q);
    const where = and(
      eq(projects.organizationId, actor.organizationId),
      q.status ? eq(projects.status, q.status) : undefined,
      q.search ? or(ilike(projects.name, likeTerm(q.search)), ilike(projects.description, likeTerm(q.search))) : undefined,
    );
    const column = q.sort === 'name' ? projects.name : q.sort === 'createdAt' ? projects.createdAt : projects.updatedAt;
    const [rows, [total]] = await Promise.all([
      this.select()
        .where(where)
        .orderBy(q.direction === 'asc' ? asc(column) : desc(column), asc(projects.id))
        .limit(params.pageSize)
        .offset(offsetOf(params)),
      this.db.select({ n: count() }).from(projects).where(where),
    ]);
    return toPage(
      rows.map((r) => this.toDto(r.p, r.u?.id ? r.u : null)),
      total?.n ?? 0,
      params,
    );
  }

  async get(actor: Actor, id: string) {
    assertCan(actor, 'projects.read');
    return this.load(actor, id);
  }

  private async assertUniqueName(actor: Actor, name: string, exceptId?: string) {
    const [dup] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, actor.organizationId), sql`lower(${projects.name}) = lower(${name})`, exceptId ? sql`${projects.id} <> ${exceptId}` : undefined));
    if (dup) throw AppError.conflict('Ya existe un proyecto con ese nombre', [{ path: 'name', message: 'Ya existe un proyecto con ese nombre' }]);
  }

  async create(actor: Actor, input: CreateProjectInput) {
    assertCan(actor, 'projects.manage');
    await this.assertUniqueName(actor, input.name);
    const [row] = await this.db
      .insert(projects)
      .values({ organizationId: actor.organizationId, name: input.name, description: input.description ?? null, createdBy: actor.userId })
      .returning();
    await recordAudit(this.db, actor, { action: 'projects.create', resourceType: 'project', resourceId: row!.id, outcome: 'success', after: { name: row!.name, description: row!.description } });
    return this.load(actor, row!.id);
  }

  async update(actor: Actor, id: string, input: UpdateProjectInput) {
    assertCan(actor, 'projects.manage');
    const before = await this.load(actor, id);
    if (input.name && input.name.toLowerCase() !== before.name.toLowerCase()) await this.assertUniqueName(actor, input.name, id);
    const patch: Partial<typeof projects.$inferInsert> = { version: sql`${projects.version} + 1` as unknown as number };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.status !== undefined && input.status !== before.status) {
      patch.status = input.status;
      patch.archivedAt = input.status === 'archived' ? new Date() : null;
    }
    // Optimistic concurrency: only the version that was read can be updated.
    const [row] = await this.db
      .update(projects)
      .set(patch)
      .where(and(eq(projects.id, id), eq(projects.organizationId, actor.organizationId), eq(projects.version, input.version)))
      .returning();
    if (!row) throw AppError.precondition('El proyecto fue modificado por otra persona; recarga para ver los cambios', { currentVersion: before.version });
    const after = await this.load(actor, id);
    await recordAudit(this.db, actor, {
      action: input.status && input.status !== before.status ? (input.status === 'archived' ? 'projects.archive' : 'projects.restore') : 'projects.update',
      resourceType: 'project',
      resourceId: id,
      outcome: 'success',
      before: { name: before.name, description: before.description, status: before.status },
      after: { name: after.name, description: after.description, status: after.status },
    });
    return after;
  }

  async remove(actor: Actor, id: string) {
    assertCan(actor, 'projects.manage');
    const before = await this.load(actor, id);
    await this.db.delete(projects).where(and(eq(projects.id, id), eq(projects.organizationId, actor.organizationId)));
    await recordAudit(this.db, actor, { action: 'projects.delete', resourceType: 'project', resourceId: id, outcome: 'success', before: { name: before.name, status: before.status } });
  }
}
