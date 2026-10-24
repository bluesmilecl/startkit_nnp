import { getEnv } from '@starter/config';
import { createDb, runMigrations, waitForDatabase } from '@starter/db';
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
  const handle = createDb(url, { max: 2, ssl: env.DATABASE_SSL, applicationName: 'starter-migrate' });
  try {
    const result = await seedBaseData(handle.db, env);
    log.info(result, 'base data ready');
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
