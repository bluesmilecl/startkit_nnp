import { AppError } from '@starter/contracts';
import { and, asc, count, eq, isNull, memberships, organizations, sessions, sql, userRoles, users } from '@starter/db';
import { assertCan, type AccessDeps, type Actor } from './actor.js';
import { recordAudit } from './audit.js';

/**
 * Organizations module (activable). When disabled every record belongs to the internal default
 * workspace, keeping the same ownership contract so the module can be turned on later.
 */
export class OrganizationsService {
  constructor(private readonly deps: AccessDeps) {}

  private assertEnabled(): void {
    if (!this.deps.features.organizations) throw new AppError('FEATURE_DISABLED', 'El módulo de organizaciones está desactivado');
  }

  async listMine(actor: Actor) {
    const rows = await this.deps.db
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, isDefault: organizations.isDefault })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, actor.userId), isNull(organizations.archivedAt)))
      .orderBy(asc(organizations.name));
    return rows;
  }

  async list(actor: Actor) {
    this.assertEnabled();
    assertCan(actor, 'organizations.read');
    const platform = actor.platformPermissions.has('organizations.read');
    const rows = await this.deps.db
      .select({
        org: organizations,
        memberCount: sql<number>`(select count(*)::int from ${memberships} m where m.organization_id = ${organizations.id})`,
      })
      .from(organizations)
      .where(platform ? undefined : sql`${organizations.id} in ${actor.organizationIds.length ? actor.organizationIds : ['00000000-0000-0000-0000-000000000000']}`)
      .orderBy(asc(organizations.name));
    return rows.map((r) => ({
      id: r.org.id,
      name: r.org.name,
      slug: r.org.slug,
      isDefault: r.org.isDefault,
      memberCount: r.memberCount,
      createdAt: r.org.createdAt.toISOString(),
      archivedAt: r.org.archivedAt?.toISOString() ?? null,
    }));
  }

  async create(actor: Actor, input: { name: string; slug: string }) {
    this.assertEnabled();
    assertCan(actor, 'organizations.manage');
    if (!actor.platformPermissions.has('organizations.manage')) throw AppError.forbidden('Crear organizaciones requiere privilegios de plataforma');
    return this.deps.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, input.slug));
      if (dup) throw AppError.conflict('Ya existe una organización con ese identificador');
      const [org] = await tx.insert(organizations).values({ name: input.name, slug: input.slug }).returning();
      await tx.insert(memberships).values({ userId: actor.userId, organizationId: org!.id });
      await recordAudit(tx, actor, { action: 'organizations.create', resourceType: 'organization', resourceId: org!.id, outcome: 'success', after: input, organizationId: org!.id });
      return { ...org!, memberCount: 1, createdAt: org!.createdAt.toISOString(), archivedAt: null };
    });
  }

  private async assertManageable(actor: Actor, organizationId: string) {
    assertCan(actor, 'organizations.manage');
    if (!actor.platformPermissions.has('organizations.manage') && organizationId !== actor.organizationId) {
      throw AppError.notFound('Organización');
    }
    const [org] = await this.deps.db.select().from(organizations).where(eq(organizations.id, organizationId));
    if (!org) throw AppError.notFound('Organización');
    return org;
  }

  async members(actor: Actor, organizationId: string) {
    this.assertEnabled();
    assertCan(actor, 'organizations.read');
    if (!actor.platformPermissions.has('organizations.read') && !actor.organizationIds.includes(organizationId)) {
      throw AppError.notFound('Organización');
    }
    return this.deps.db
      .select({ id: users.id, email: users.email, name: users.name, joinedAt: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(asc(users.name));
  }

  async addMember(actor: Actor, organizationId: string, userId: string) {
    this.assertEnabled();
    await this.assertManageable(actor, organizationId);
    await this.deps.db.insert(memberships).values({ userId, organizationId }).onConflictDoNothing();
    await recordAudit(this.deps.db, actor, { action: 'organizations.addMember', resourceType: 'organization', resourceId: organizationId, outcome: 'success', after: { userId }, organizationId });
  }

  async removeMember(actor: Actor, organizationId: string, userId: string) {
    this.assertEnabled();
    const org = await this.assertManageable(actor, organizationId);
    if (org.isDefault) throw AppError.precondition('No se puede quitar miembros del espacio principal');
    await this.deps.db.transaction(async (tx) => {
      await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.organizationId, organizationId)));
      await tx.delete(memberships).where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));
      await tx
        .update(sessions)
        .set({ activeOrganizationId: null })
        .where(and(eq(sessions.userId, userId), eq(sessions.activeOrganizationId, organizationId)));
      await recordAudit(tx, actor, { action: 'organizations.removeMember', resourceType: 'organization', resourceId: organizationId, outcome: 'success', before: { userId }, organizationId });
    });
  }

  /** Switches the active organization stored on the current session (membership required). */
  async switchActive(actor: Actor, organizationId: string): Promise<void> {
    this.assertEnabled();
    if (!actor.organizationIds.includes(organizationId)) throw AppError.forbidden('No perteneces a esa organización');
    if (!actor.sessionId) throw AppError.precondition('Sesión requerida');
    await this.deps.db.update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.id, actor.sessionId));
  }

  async memberCount(organizationId: string): Promise<number> {
    const [row] = await this.deps.db.select({ n: count() }).from(memberships).where(eq(memberships.organizationId, organizationId));
    return row?.n ?? 0;
  }
}
