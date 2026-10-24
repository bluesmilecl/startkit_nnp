import { InvitationsService, syncAccessCatalog } from '@starter/auth';
import type { Env } from '@starter/config';
import { DEFAULT_ORGANIZATION_ID, organizations, type Database } from '@starter/db';

/** Idempotent base data required by every installation. */
export async function seedBaseData(db: Database, env: Env) {
  await db
    .insert(organizations)
    .values({ id: DEFAULT_ORGANIZATION_ID, name: 'Espacio principal', slug: 'default', isDefault: true })
    .onConflictDoNothing();
  const catalog = await syncAccessCatalog(db);
  const owner = env.OWNER_EMAIL ? await InvitationsService.bootstrapOwner(db, env.OWNER_EMAIL) : { result: 'not-configured' as const };
  return { organization: DEFAULT_ORGANIZATION_ID, permissions: catalog.permissions, createdRoles: catalog.createdRoles, owner: owner.result };
}
