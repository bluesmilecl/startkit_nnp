import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sslOption, type CreateDbOptions } from './client.js';

export const CORE_MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Stable advisory lock id so that only one migrator runs per database at a time. */
const MIGRATION_LOCK_ID = 727_001;

export interface MigrationOptions {
  migrationsFolder?: string;
  migrationsSchema?: string;
  migrationsTable?: string;
  lockId?: number;
  ssl?: CreateDbOptions['ssl'];
  /** Maximum time to wait for the lock before failing. */
  lockTimeoutMs?: number;
}

/**
 * Applies versioned SQL migrations with mutual exclusion (pg_advisory_lock). Safe to run from
 * several replicas: the others wait for the lock and then find nothing to apply.
 */
export async function runMigrations(url: string, opts: MigrationOptions = {}): Promise<{ applied: boolean }> {
  const client = new pg.Client({ connectionString: url, ssl: sslOption(opts.ssl), application_name: 'starter-migrate' });
  await client.connect();
  try {
    await client.query(`set lock_timeout = ${Math.max(1000, opts.lockTimeoutMs ?? 120_000)}`);
    await client.query('select pg_advisory_lock($1)', [opts.lockId ?? MIGRATION_LOCK_ID]);
    await client.query('set lock_timeout = 0');
    const db = drizzle(client);
    await migrate(db, {
      migrationsFolder: opts.migrationsFolder ?? CORE_MIGRATIONS_FOLDER,
      migrationsSchema: opts.migrationsSchema ?? 'public',
      migrationsTable: opts.migrationsTable ?? '__migrations',
    });
    return { applied: true };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [opts.lockId ?? MIGRATION_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}
