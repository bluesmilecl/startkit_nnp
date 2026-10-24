import { InvitationsService, loadActor, syncAccessCatalog, type AccessDeps, type Actor } from '@starter/auth';
import { featureFlags, parseEnv, resetEnvCache, type Env, type FeatureFlags } from '@starter/config';
import { createDb, DEFAULT_ORGANIZATION_ID, memberships, organizations, roles, runMigrations, userRoles, users, eq, isNull, and, type DbHandle } from '@starter/db';
import { createMailer } from '@starter/mail';
import { randomUUID } from 'node:crypto';
import { recreateTestDatabase } from './global-db.js';

let shared: { env: Env; handle: DbHandle } | undefined;

/** Fresh migrated database shared by the integration files of this run. */
export async function testContext(): Promise<{ env: Env; handle: DbHandle }> {
  if (shared) return shared;
  const base = process.env.DATABASE_URL ?? 'postgres://starter:starter@localhost:5432/starter';
  const url = process.env.__IT_DATABASE_URL ?? (await recreateTestDatabase(base));
  process.env.__IT_DATABASE_URL = url;
  process.env.DATABASE_URL = url;
  resetEnvCache();
  const env = parseEnv(process.env);
  await runMigrations(url);
  const handle = createDb(url, { max: 5 });
  await handle.db
    .insert(organizations)
    .values({ id: DEFAULT_ORGANIZATION_ID, name: 'Espacio principal', slug: 'default', isDefault: true })
    .onConflictDoNothing();
  await syncAccessCatalog(handle.db);
  shared = { env, handle };
  return shared;
}

export function deps(env: Env, handle: DbHandle, features?: Partial<FeatureFlags>): AccessDeps {
  return { db: handle.db, env, features: { ...featureFlags(env), ...features }, mailer: createMailer({ ...env, MAIL_TRANSPORT: 'log' }) };
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

export async function makeUser(
  handle: DbHandle,
  opts: { email?: string; name?: string; roles?: string[]; organizationId?: string; orgRoles?: { key: string; organizationId: string }[] } = {},
): Promise<{ id: string; email: string }> {
  const email = opts.email ?? uniqueEmail();
  const [u] = await handle.db
    .insert(users)
    .values({ email, name: opts.name ?? email.split('@')[0]!, emailVerified: true })
    .returning();
  await handle.db.insert(memberships).values({ userId: u!.id, organizationId: opts.organizationId ?? DEFAULT_ORGANIZATION_ID }).onConflictDoNothing();
  for (const key of opts.roles ?? []) {
    const [r] = await handle.db.select().from(roles).where(and(eq(roles.key, key), isNull(roles.organizationId)));
    await handle.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id, organizationId: null });
  }
  for (const or of opts.orgRoles ?? []) {
    const [r] = await handle.db.select().from(roles).where(and(eq(roles.key, or.key), isNull(roles.organizationId)));
    await handle.db.insert(memberships).values({ userId: u!.id, organizationId: or.organizationId }).onConflictDoNothing();
    await handle.db.insert(userRoles).values({ userId: u!.id, roleId: r!.id, organizationId: or.organizationId });
  }
  return { id: u!.id, email };
}

export async function actorFor(handle: DbHandle, userId: string, features: Partial<FeatureFlags> = {}, organizationId?: string): Promise<Actor> {
  return loadActor(
    { db: handle.db, features: { organizations: false, ai: true, rag: true, ...features } },
    { userId, channel: 'panel', organizationId },
  );
}

export async function roleId(handle: DbHandle, key: string): Promise<string> {
  const [r] = await handle.db.select().from(roles).where(and(eq(roles.key, key), isNull(roles.organizationId)));
  return r!.id;
}

/** Removes every platform owner assignment so that tests control the owner count. */
export async function resetOwners(handle: DbHandle): Promise<void> {
  const ownerId = await roleId(handle, 'owner');
  await handle.db.delete(userRoles).where(eq(userRoles.roleId, ownerId));
}

export { InvitationsService };
