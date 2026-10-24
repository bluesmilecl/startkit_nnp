import { AppError, type CreateInvitationInput } from '@starter/contracts';
import {
  and,
  count,
  DEFAULT_ORGANIZATION_ID,
  desc,
  eq,
  gt,
  invitations,
  memberships,
  normalizePage,
  offsetOf,
  roles,
  sql,
  toPage,
  userRoles,
  users,
  type Database,
  type DbOrTx,
} from '@starter/db';
import { invitationEmail } from '@starter/mail';
import { createLogger, sanitizeError } from '@starter/observability';
import { assertCan, systemActor, type AccessDeps, type Actor } from './actor.js';
import { recordAudit } from './audit.js';
import { systemRoleId } from './catalog.js';
import { activeOwnerCount, assertCanManageRole } from './policies.js';
import { SettingsService } from './settings.js';

const log = createLogger('invitations');

export class InvitationsService {
  constructor(private readonly deps: AccessDeps) {}

  private async summaries(rows: (typeof invitations.$inferSelect)[]) {
    const roleIds = [...new Set(rows.map((r) => r.roleId).filter(Boolean))] as string[];
    const roleRows = roleIds.length
      ? await this.deps.db.select().from(roles).where(sql`${roles.id} in ${roleIds}`)
      : [];
    const roleMap = new Map(roleRows.map((r) => [r.id, r]));
    return rows.map((r) => {
      const role = r.roleId ? roleMap.get(r.roleId) : undefined;
      const expired = r.status === 'pending' && r.expiresAt < new Date();
      return {
        id: r.id,
        email: r.email,
        role: role ? { id: role.id, key: role.key, name: role.name, organizationId: r.organizationId } : null,
        status: expired ? ('expired' as const) : r.status,
        kind: r.kind,
        invitedBy: r.invitedBy,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        acceptedAt: r.acceptedAt?.toISOString() ?? null,
      };
    });
  }

  async list(actor: Actor, query: { page?: number; pageSize?: number; status?: string }) {
    assertCan(actor, 'users.invite');
    const params = normalizePage(query);
    const where = and(
      eq(invitations.organizationId, actor.organizationId),
      query.status ? eq(invitations.status, query.status as 'pending') : undefined,
    );
    const [rows, total] = await Promise.all([
      this.deps.db.select().from(invitations).where(where).orderBy(desc(invitations.createdAt)).limit(params.pageSize).offset(offsetOf(params)),
      this.deps.db.select({ n: count() }).from(invitations).where(where),
    ]);
    return toPage(await this.summaries(rows), total[0]?.n ?? 0, params);
  }

  async create(actor: Actor, input: CreateInvitationInput) {
    assertCan(actor, 'users.invite');
    const email = input.email.toLowerCase();
    let roleName: string | null = null;
    const id = await this.deps.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      if (existing) throw AppError.conflict('Ese correo ya tiene una cuenta; asígnale un rol en lugar de invitarlo', { userId: existing.id });
      if (input.roleId) {
        assertCan(actor, 'roles.manage');
        const [role] = await tx.select().from(roles).where(eq(roles.id, input.roleId)).limit(1);
        if (!role) throw AppError.notFound('Rol');
        assertCanManageRole(actor, role);
        roleName = role.name;
      }
      await tx
        .update(invitations)
        .set({ status: 'revoked' })
        .where(and(sql`lower(${invitations.email}) = ${email}`, eq(invitations.status, 'pending'), eq(invitations.kind, 'invite')));
      const [inv] = await tx
        .insert(invitations)
        .values({
          email,
          roleId: input.roleId ?? null,
          organizationId: actor.organizationId,
          invitedBy: actor.userId,
          kind: 'invite',
          expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
        })
        .returning();
      await recordAudit(tx, actor, {
        action: 'users.invite',
        resourceType: 'invitation',
        resourceId: inv!.id,
        outcome: 'success',
        after: { email, roleId: input.roleId ?? null },
      });
      return inv!.id;
    });
    await this.send(email, actor.name, roleName);
    const [row] = await this.deps.db.select().from(invitations).where(eq(invitations.id, id));
    return (await this.summaries([row!]))[0]!;
  }

  async revoke(actor: Actor, id: string) {
    assertCan(actor, 'users.invite');
    await this.deps.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invitations)
        .where(and(eq(invitations.id, id), eq(invitations.organizationId, actor.organizationId)))
        .limit(1);
      if (!inv) throw AppError.notFound('Invitación', 'f');
      if (inv.kind === 'bootstrap' && !actor.isOwner) throw AppError.forbidden('Solo un propietario puede revocar la preasignación');
      if (inv.status !== 'pending') throw AppError.conflict('La invitación ya no está pendiente');
      await tx.update(invitations).set({ status: 'revoked' }).where(eq(invitations.id, id));
      await recordAudit(tx, actor, { action: 'invitations.revoke', resourceType: 'invitation', resourceId: id, outcome: 'success', before: { email: inv.email } });
    });
  }

  async resend(actor: Actor, id: string) {
    assertCan(actor, 'users.invite');
    const [inv] = await this.deps.db
      .select()
      .from(invitations)
      .where(and(eq(invitations.id, id), eq(invitations.organizationId, actor.organizationId)))
      .limit(1);
    if (!inv || inv.status !== 'pending' || inv.expiresAt < new Date()) throw AppError.conflict('La invitación no está vigente');
    const role = inv.roleId ? (await this.deps.db.select().from(roles).where(eq(roles.id, inv.roleId)))[0] : undefined;
    await this.send(inv.email, actor.name, role?.name ?? null);
    await recordAudit(this.deps.db, actor, { action: 'invitations.resend', resourceType: 'invitation', resourceId: id, outcome: 'success' });
  }

  /** Records an invitation for a user created by an administrator and e-mails them. */
  async notifyExistingUser(actor: Actor, email: string, roleId: string | null) {
    const [inv] = await this.deps.db
      .insert(invitations)
      .values({
        email,
        roleId,
        organizationId: actor.organizationId,
        invitedBy: actor.userId,
        kind: 'invite',
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      })
      .returning();
    const role = roleId ? (await this.deps.db.select().from(roles).where(eq(roles.id, roleId)))[0] : undefined;
    await this.send(email, actor.name, role?.name ?? null);
    return inv!;
  }

  private async send(email: string, inviter: string | null, roleName: string | null) {
    const branding = await new SettingsService(this.deps).branding();
    const tpl = invitationEmail({ appName: branding.appName, primaryColor: branding.primaryColor, appUrl: this.deps.env.APP_URL }, inviter, roleName, email);
    try {
      await this.deps.mailer.send({ to: email, ...tpl, category: 'invitation' });
    } catch (err) {
      log.error({ err: sanitizeError(err) }, 'invitation e-mail failed');
      throw new AppError('UPSTREAM_ERROR', 'La invitación se registró pero el correo no pudo enviarse; revisa la configuración de correo');
    }
  }

  /** Whether self-registration through OTP may create an account for this e-mail. */
  static async registrationAllowed(db: Database, mode: 'open' | 'invite-only' | 'disabled', email: string): Promise<boolean> {
    const [inv] = await db
      .select({ kind: invitations.kind })
      .from(invitations)
      .where(and(sql`lower(${invitations.email}) = lower(${email})`, eq(invitations.status, 'pending'), gt(invitations.expiresAt, new Date())))
      .limit(1);
    if (inv?.kind === 'bootstrap') return true;
    if (mode === 'disabled') return false;
    if (mode === 'open') return true;
    return !!inv;
  }

  /**
   * Applies pending invitations of an e-mail to a user (roles + memberships) and marks them
   * accepted. Called when a user is created via OTP and on every successful sign-in.
   */
  static async acceptPending(db: DbOrTx, user: { id: string; email: string }, opts: { defaultRole?: 'viewer' | null } = {}): Promise<number> {
    const pending = await db
      .select()
      .from(invitations)
      .where(and(sql`lower(${invitations.email}) = lower(${user.email})`, eq(invitations.status, 'pending'), gt(invitations.expiresAt, new Date())));
    for (const inv of pending) {
      const orgId = inv.organizationId ?? DEFAULT_ORGANIZATION_ID;
      await db.insert(memberships).values({ userId: user.id, organizationId: orgId }).onConflictDoNothing();
      if (inv.roleId) {
        const [role] = await db.select().from(roles).where(eq(roles.id, inv.roleId)).limit(1);
        if (role) {
          await db
            .insert(userRoles)
            .values({
              userId: user.id,
              roleId: role.id,
              organizationId: role.scope === 'organization' ? (role.organizationId ?? orgId) : null,
              assignedBy: inv.invitedBy,
            })
            .onConflictDoNothing();
        }
      }
      await db.update(invitations).set({ status: 'accepted', acceptedAt: new Date(), acceptedUserId: user.id }).where(eq(invitations.id, inv.id));
      await recordAudit(db, null, {
        action: inv.kind === 'bootstrap' ? 'owner.bootstrap.accepted' : 'invitations.accept',
        resourceType: 'invitation',
        resourceId: inv.id,
        outcome: 'success',
        organizationId: orgId,
        after: { userId: user.id },
      });
    }
    if (!pending.length && opts.defaultRole) {
      await db.insert(memberships).values({ userId: user.id, organizationId: DEFAULT_ORGANIZATION_ID }).onConflictDoNothing();
      const [role] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.key, opts.defaultRole), sql`${roles.organizationId} is null`));
      const [has] = await db.select({ n: count() }).from(userRoles).where(eq(userRoles.userId, user.id));
      if (role && !has?.n) await db.insert(userRoles).values({ userId: user.id, roleId: role.id, organizationId: null }).onConflictDoNothing();
    }
    return pending.length;
  }

  /**
   * Trusted owner pre-assignment (installer / migrate service / CLI with database access).
   * Limited: it only acts while no other active owner exists unless `allowAdditional` is set.
   */
  static async bootstrapOwner(
    db: Database,
    email: string,
    opts: { allowAdditional?: boolean } = {},
  ): Promise<{ result: 'assigned' | 'invited' | 'already-owner' | 'owner-exists' }> {
    const normalized = email.trim().toLowerCase();
    const ownerRoleId = await systemRoleId(db, 'owner');
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(727002)`);
      const [user] = await tx.select().from(users).where(sql`lower(${users.email}) = ${normalized}`).limit(1);
      if (user) {
        const [has] = await tx
          .select({ n: count() })
          .from(userRoles)
          .where(and(eq(userRoles.userId, user.id), eq(userRoles.roleId, ownerRoleId)));
        if (has?.n) return { result: 'already-owner' as const };
      }
      if (!opts.allowAdditional && (await activeOwnerCount(tx)) > 0) return { result: 'owner-exists' as const };
      if (user) {
        await tx.insert(memberships).values({ userId: user.id, organizationId: DEFAULT_ORGANIZATION_ID }).onConflictDoNothing();
        await tx.insert(userRoles).values({ userId: user.id, roleId: ownerRoleId, organizationId: null });
        await recordAudit(tx, systemActor(), { action: 'owner.bootstrap.assigned', resourceType: 'user', resourceId: user.id, outcome: 'success' });
        return { result: 'assigned' as const };
      }
      await tx
        .update(invitations)
        .set({ status: 'revoked' })
        .where(and(eq(invitations.kind, 'bootstrap'), eq(invitations.status, 'pending')));
      const [inv] = await tx
        .insert(invitations)
        .values({
          email: normalized,
          roleId: ownerRoleId,
          organizationId: DEFAULT_ORGANIZATION_ID,
          kind: 'bootstrap',
          expiresAt: new Date(Date.now() + 365 * 86_400_000),
        })
        .returning();
      await recordAudit(tx, systemActor(), {
        action: 'owner.bootstrap.invited',
        resourceType: 'invitation',
        resourceId: inv!.id,
        outcome: 'success',
        after: { email: normalized },
      });
      return { result: 'invited' as const };
    });
  }
}
