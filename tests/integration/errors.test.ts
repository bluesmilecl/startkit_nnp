import { randomUUID } from 'node:crypto';
import { DEFAULT_ORGANIZATION_ID, isForeignKeyViolation, isUniqueViolation, mapDatabaseError, projects, sql, type DbHandle } from '@starter/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { testContext } from './helpers.js';

let handle: DbHandle;

beforeAll(async () => {
  ({ handle } = await testContext());
});

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a database error');
}

/** The mapping is checked against what PostgreSQL and Drizzle really throw (wrapped driver errors). */
describe('database errors through Drizzle', () => {
  it('a case-insensitive duplicate name hits the named unique index', async () => {
    const name = `Único ${randomUUID().slice(0, 8)}`;
    await handle.db.insert(projects).values({ organizationId: DEFAULT_ORGANIZATION_ID, name });
    const err = await caught(handle.db.insert(projects).values({ organizationId: DEFAULT_ORGANIZATION_ID, name: name.toUpperCase() }));
    expect(isUniqueViolation(err, 'projects_org_name_uq')).toBe(true);
    expect(mapDatabaseError(err)).toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('foreign keys, malformed values and timeouts map to catalog errors', async () => {
    const fk = await caught(handle.db.insert(projects).values({ organizationId: randomUUID(), name: 'Huérfano' }));
    expect(isForeignKeyViolation(fk)).toBe(true);
    expect(mapDatabaseError(fk)?.code).toBe('CONFLICT');

    const badUuid = await caught(handle.db.execute(sql`select * from projects where id = ${'no-es-uuid'}::uuid`));
    expect(mapDatabaseError(badUuid)?.code).toBe('BAD_REQUEST');

    const slow = await caught(
      handle.db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '50ms'`);
        await tx.execute(sql`select pg_sleep(1)`);
      }),
    );
    expect(mapDatabaseError(slow)).toMatchObject({ code: 'TIMEOUT', status: 504, retryable: true });
  });
});
