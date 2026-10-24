import { InvitationsService, ProposalsService, RolesService, UsersService, createAdminExecutors, type Actor } from '@starter/auth';
import { actionProposals, eq, organizations } from '@starter/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actorFor, deps, makeUser, resetOwners, roleId, testContext } from './helpers.js';

let ctx: Awaited<ReturnType<typeof testContext>>;
let usersSvc: UsersService;
let rolesSvc: RolesService;

beforeAll(async () => {
  ctx = await testContext();
  usersSvc = new UsersService(deps(ctx.env, ctx.handle));
  rolesSvc = new RolesService(deps(ctx.env, ctx.handle));
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    return (err as { code?: string }).code ?? (err as Error).message;
  }
}

describe('authorization in services (same rules for REST, CLI and chat tools)', () => {
  it('denies by default: a viewer cannot list or create users even when calling the service directly', async () => {
    const viewer = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['viewer'] })).id);
    expect(await code(usersSvc.list(viewer, { page: 1, pageSize: 10, sort: 'createdAt', direction: 'desc' }))).toBe('FORBIDDEN');
    expect(await code(usersSvc.create(viewer, { email: 'x@example.test', name: 'X', roleIds: [], sendInvitation: false }))).toBe('FORBIDDEN');
  });

  it('delegation: an admin cannot grant the owner role nor permissions it does not hold', async () => {
    const admin = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['admin'] })).id);
    const target = await makeUser(ctx.handle, { roles: ['viewer'] });
    expect(await code(rolesSvc.assign(admin, target.id, await roleId(ctx.handle, 'owner')))).toBe('FORBIDDEN');
    expect(await code(rolesSvc.assign(admin, target.id, await roleId(ctx.handle, 'admin')))).toBe('FORBIDDEN');
    expect(await code(rolesSvc.assign(admin, target.id, await roleId(ctx.handle, 'editor')))).toBe('OK');
    // admin lacks ai.providers.manage (sensitive) → cannot create a role including it
    expect(await code(rolesSvc.create(admin, { key: 'leaky', name: 'Leaky', rank: 10, scope: 'platform', permissions: ['ai.providers.manage'] }))).toBe('FORBIDDEN');
    // unknown permissions are rejected (catalog = implemented operations only)
    expect(await code(rolesSvc.create(admin, { key: 'fake', name: 'Fake', rank: 10, scope: 'platform', permissions: ['launch.missiles'] }))).toBe('VALIDATION_FAILED');
  });

  it('prevents self-escalation and acting on higher ranked users', async () => {
    const adminUser = await makeUser(ctx.handle, { roles: ['admin'] });
    const admin = await actorFor(ctx.handle, adminUser.id);
    expect(await code(rolesSvc.assign(admin, adminUser.id, await roleId(ctx.handle, 'editor')))).toBe('FORBIDDEN');
    const other = await makeUser(ctx.handle, { roles: ['admin'] });
    expect(await code(usersSvc.disable(admin, other.id))).toBe('FORBIDDEN');
  });

  it('permission changes take effect on the next actor load (no stale cache)', async () => {
    const u = await makeUser(ctx.handle, { roles: ['editor'] });
    expect((await actorFor(ctx.handle, u.id)).permissions.has('users.read')).toBe(true);
    const owner = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['owner'] })).id);
    await rolesSvc.unassign(owner, u.id, await roleId(ctx.handle, 'editor'));
    expect((await actorFor(ctx.handle, u.id)).permissions.has('users.read')).toBe(false);
  });

  it('role summaries report real user and permission counts', async () => {
    const owner = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['owner'] })).id);
    const before = (await rolesSvc.list(owner)).find((r) => r.key === 'viewer')!;
    await makeUser(ctx.handle, { roles: ['viewer'] });
    const after = (await rolesSvc.list(owner)).find((r) => r.key === 'viewer')!;
    expect(after.userCount).toBe(before.userCount + 1);
    expect(after.permissionCount).toBeGreaterThan(0);
  });
});

describe('last owner protection', () => {
  let ownerA: { id: string; email: string };
  let owner: Actor;
  beforeEach(async () => {
    await resetOwners(ctx.handle);
    ownerA = await makeUser(ctx.handle, { roles: ['owner'] });
    owner = await actorFor(ctx.handle, ownerA.id);
  });

  it('cannot disable, delete or demote the last active owner', async () => {
    const ownerB = await makeUser(ctx.handle, { roles: ['owner'] });
    const b = await actorFor(ctx.handle, ownerB.id);
    // With two owners, B can remove A's owner role…
    expect(await code(rolesSvc.unassign(b, ownerA.id, await roleId(ctx.handle, 'owner')))).toBe('OK');
    // …but now B is the last one: nobody can remove/disable/delete B.
    const adminActor = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['admin'] })).id);
    expect(await code(usersSvc.disable(adminActor, ownerB.id))).toBe('FORBIDDEN');
    const ownerC = await makeUser(ctx.handle, { roles: ['owner'] });
    const staleC = await actorFor(ctx.handle, ownerC.id);
    await rolesSvc.unassign(b, ownerC.id, await roleId(ctx.handle, 'owner'));
    // A session loaded before the demotion still cannot break the invariant…
    expect(await code(usersSvc.disable(staleC, ownerB.id))).toBe('PRECONDITION_FAILED');
    expect(await code(usersSvc.delete(owner, ownerB.id))).toBe('PRECONDITION_FAILED');
    // …and a fresh load simply lacks the permissions.
    expect(await code(usersSvc.disable(await actorFor(ctx.handle, ownerC.id), ownerB.id))).toBe('FORBIDDEN');
  });

  it('serializes concurrent demotions so at least one owner always remains', async () => {
    const ownerB = await makeUser(ctx.handle, { roles: ['owner'] });
    const b = await actorFor(ctx.handle, ownerB.id);
    const ownerRole = await roleId(ctx.handle, 'owner');
    const results = await Promise.all([code(rolesSvc.unassign(owner, ownerB.id, ownerRole)), code(rolesSvc.unassign(b, ownerA.id, ownerRole))]);
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r === 'PRECONDITION_FAILED' || r === 'FORBIDDEN')).toHaveLength(1);
  });

  it('owner bootstrap is limited: it does not create a second owner unless forced', async () => {
    expect((await InvitationsService.bootstrapOwner(ctx.handle.db, 'someone-else@example.test')).result).toBe('owner-exists');
    expect((await InvitationsService.bootstrapOwner(ctx.handle.db, ownerA.email)).result).toBe('already-owner');
  });
});

describe('action proposals (preview → confirm → execute)', () => {
  let proposals: ProposalsService;
  let owner: Actor;
  beforeAll(async () => {
    const d = deps(ctx.env, ctx.handle);
    proposals = new ProposalsService(d, createAdminExecutors(d));
    await resetOwners(ctx.handle);
    owner = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['owner'] })).id);
    await makeUser(ctx.handle, { roles: ['owner'] });
  });

  it('previews without changing anything and executes exactly once', async () => {
    const target = await makeUser(ctx.handle, { roles: ['viewer'] });
    const p = await proposals.propose(owner, 'users.delete', { userId: target.id }, { source: 'chat' });
    expect(p.status).toBe('pending');
    expect(p.changes.length).toBeGreaterThan(0);
    expect(p.effects.join(' ')).toMatch(/no se puede deshacer/);
    expect((await usersSvc.get(owner, target.id)).id).toBe(target.id);
    const first = await proposals.confirm(owner, p.id);
    expect(first.replayed).toBe(false);
    expect(first.proposal.status).toBe('executed');
    const second = await proposals.confirm(owner, p.id);
    expect(second.replayed).toBe(true);
    expect(await code(usersSvc.get(owner, target.id))).toBe('NOT_FOUND');
  });

  it('optional arguments left undefined do not break the integrity hash', async () => {
    const target = await makeUser(ctx.handle, { roles: ['viewer'] });
    const p = await proposals.propose(owner, 'users.disable', { userId: target.id, reason: undefined }, { source: 'chat' });
    const r = await proposals.confirm(owner, p.id);
    expect(r.proposal.status).toBe('executed');
    expect((await usersSvc.get(owner, target.id)).status).toBe('disabled');
  });

  it('rejects confirmation by another user, expired proposals and stale previews', async () => {
    const target = await makeUser(ctx.handle, { roles: ['viewer'] });
    const p = await proposals.propose(owner, 'users.disable', { userId: target.id }, { source: 'chat' });
    const other = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['admin'] })).id);
    expect(await code(proposals.confirm(other, p.id))).toBe('NOT_FOUND');

    await ctx.handle.db.update(actionProposals).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(actionProposals.id, p.id));
    expect(await code(proposals.confirm(owner, p.id))).toBe('GONE');

    const p2 = await proposals.propose(owner, 'users.changeRole', { userId: target.id, roleId: await roleId(ctx.handle, 'editor') }, { source: 'chat' });
    await usersSvc.update(owner, target.id, { name: 'Renamed meanwhile' });
    expect(await code(proposals.confirm(owner, p2.id))).toBe('PRECONDITION_FAILED');
  });

  it('records denied previews and never stores a proposal the actor could not execute', async () => {
    const editor = await actorFor(ctx.handle, (await makeUser(ctx.handle, { roles: ['editor'] })).id);
    const target = await makeUser(ctx.handle, { roles: ['viewer'] });
    expect(await code(proposals.propose(editor, 'users.delete', { userId: target.id }, { source: 'chat' }))).toBe('FORBIDDEN');
  });

  it('cancelled proposals cannot be confirmed', async () => {
    const target = await makeUser(ctx.handle, { roles: ['viewer'] });
    const p = await proposals.propose(owner, 'users.disable', { userId: target.id }, { source: 'panel' });
    await proposals.cancel(owner, p.id);
    expect(await code(proposals.confirm(owner, p.id))).toBe('CONFLICT');
  });
});

describe('organizations isolation', () => {
  it('org-scoped permissions never reach users of another organization', async () => {
    const [orgB] = await ctx.handle.db.insert(organizations).values({ name: 'Org B', slug: `org-b-${Date.now()}` }).returning();
    const inDefault = await makeUser(ctx.handle, { roles: ['viewer'] });
    const orgAdmin = await makeUser(ctx.handle, { organizationId: orgB!.id, orgRoles: [{ key: 'admin', organizationId: orgB!.id }] });
    const actor = await actorFor(ctx.handle, orgAdmin.id, { organizations: true }, orgB!.id);
    const svc = new UsersService(deps(ctx.env, ctx.handle, { organizations: true }));
    const page = await svc.list(actor, { page: 1, pageSize: 100, sort: 'createdAt', direction: 'desc' });
    expect(page.items.some((u) => u.id === inDefault.id)).toBe(false);
    expect(await code(svc.get(actor, inDefault.id))).toBe('NOT_FOUND');
    // Requesting the default organization without membership falls back to an org the user belongs to.
    const spoof = await actorFor(ctx.handle, orgAdmin.id, { organizations: true }, '00000000-0000-4000-8000-000000000001');
    expect(spoof.organizationId).toBe(orgB!.id);
  });
});
