import { getEnv } from '@starter/config';
import { createDb, runMigrations, sql, waitForDatabase } from '@starter/db';
import { JobQueue } from '@starter/jobs';
import { createLogger } from '@starter/observability';
import { createPgPool, migratePgStore } from '@starter/rag';
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
  const handle = createDb(url, { max: 2, ssl: env.DATABASE_SSL, applicationName: 'starter-migrate' });
  try {
    if (env.FEATURE_RAG) await upgradeInternalStores(handle, url, env.DATABASE_URL, env.DATABASE_SSL);
    await grantRuntimeAccess(url, env.DATABASE_URL, env.DATABASE_SSL);
    const result = await seedBaseData(handle.db, env);
    log.info(result, 'base data ready');
  } finally {
    await handle.close();
  }
}

/**
 * Keeps already activated internal knowledge stores on the current store schema version during
 * upgrades. Activation itself (CREATE EXTENSION vector) is an explicit step from the panel or CLI.
 */
async function upgradeInternalStores(handle: ReturnType<typeof createDb>, migrationUrl: string, runtimeUrl: string, ssl: 'disable' | 'require' | 'verify-full') {
  const ext = await handle.db.execute<{ v: string | null }>(sql`select extversion as v from pg_extension where extname = 'vector'`);
  if (!ext.rows[0]?.v) return;
  const schemas = await handle.db.execute<{ schema: string }>(sql`select distinct coalesce(config->>'schema', 'rag') as schema from rag_connections where kind = 'internal' and enabled_at is not null`);
  if (!schemas.rows.length) return;
  const pool = createPgPool(migrationUrl, { ssl, max: 1, applicationName: 'starter-migrate-rag' });
  try {
    const runtime = decodeURIComponent(new URL(runtimeUrl).username);
    const owner = decodeURIComponent(new URL(migrationUrl).username);
    for (const { schema } of schemas.rows) {
      const r = await migratePgStore(pool, schema, { createExtension: false, grantTo: runtime && runtime !== owner ? runtime : null });
      log.info({ schema, applied: r.applied }, 'internal knowledge store up to date');
    }
  } finally {
    await pool.end();
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
