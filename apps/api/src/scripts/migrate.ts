import { getEnv } from '@starter/config';
import { createDb, runMigrations, sql, waitForDatabase } from '@starter/db';
import { JobQueue } from '@starter/jobs';
import { createLogger } from '@starter/observability';
import { seedBaseData } from '../seed.js';

const log = createLogger('migrate');

/**
 * One-shot migration entrypoint (docker `migrate` service, `pnpm db:migrate`).
 * Applies versioned SQL migrations under an advisory lock, then idempotent base data.
 */
async function main(): Promise<void> {
  const env = getEnv();
  const url = env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL;
  await waitForDatabase(url, { ssl: env.DATABASE_SSL });
  log.info('applying core migrations');
  await runMigrations(url, { ssl: env.DATABASE_SSL });
  log.info('installing job queue schema');
  const jobs = await JobQueue.create({ connectionString: url, role: 'migrate' });
  await jobs.stop(false);
  await grantRuntimeAccess(url, env.DATABASE_URL, env.DATABASE_SSL);
  const handle = createDb(url, { max: 2, ssl: env.DATABASE_SSL, applicationName: 'starter-migrate' });
  try {
    const result = await seedBaseData(handle.db, env);
    log.info(result, 'base data ready');
  } finally {
    await handle.close();
  }
}

/**
 * When migrations run with a privileged role and the application uses a least-privilege role,
 * grant the runtime role DML (never DDL) on the application schemas. Idempotent.
 */
async function grantRuntimeAccess(migrationUrl: string, runtimeUrl: string, ssl: 'disable' | 'require' | 'verify-full') {
  const runtimeUser = decodeURIComponent(new URL(runtimeUrl).username);
  const migrationUser = decodeURIComponent(new URL(migrationUrl).username);
  if (!runtimeUser || runtimeUser === migrationUser) return;
  const handle = createDb(migrationUrl, { max: 1, ssl });
  try {
    const ident = `"${runtimeUser.replace(/"/g, '""')}"`;
    const schemas = await handle.db.execute<{ nspname: string }>(sql`select nspname from pg_namespace where nspname in ('public', 'pgboss', 'rag')`);
    for (const { nspname } of schemas.rows) {
      await handle.db.execute(sql.raw(`grant usage on schema "${nspname}" to ${ident}`));
      await handle.db.execute(sql.raw(`grant select, insert, update, delete on all tables in schema "${nspname}" to ${ident}`));
      await handle.db.execute(sql.raw(`grant usage, select on all sequences in schema "${nspname}" to ${ident}`));
      await handle.db.execute(sql.raw(`grant execute on all functions in schema "${nspname}" to ${ident}`));
    }
    log.info({ runtimeUser, schemas: schemas.rows.map((r) => r.nspname) }, 'runtime role grants applied');
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
   
  console.error(err);
  process.exit(1);
});
