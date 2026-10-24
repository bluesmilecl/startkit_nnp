import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
/** Transaction handle accepted by repositories (a db or an open transaction). */
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  max?: number;
  ssl?: 'disable' | 'require' | 'verify-full';
  applicationName?: string;
  statementTimeoutMs?: number;
}

export function sslOption(mode: CreateDbOptions['ssl']): pg.PoolConfig['ssl'] {
  if (!mode || mode === 'disable') return undefined;
  if (mode === 'require') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

export function createPool(url: string, opts: CreateDbOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 10,
    ssl: sslOption(opts.ssl),
    application_name: opts.applicationName ?? 'starter',
    statement_timeout: opts.statementTimeoutMs,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Without a listener an idle client error would crash the process.
  pool.on('error', () => undefined);
  return pool;
}

export function createDb(url: string, opts: CreateDbOptions = {}): DbHandle {
  const pool = createPool(url, opts);
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

/** Waits until the database accepts connections (used by containers on startup). */
export async function waitForDatabase(url: string, { attempts = 30, delayMs = 1000, ssl }: { attempts?: number; delayMs?: number; ssl?: CreateDbOptions['ssl'] } = {}): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const client = new pg.Client({ connectionString: url, ssl: sslOption(ssl) });
    try {
      await client.connect();
      await client.query('select 1');
      await client.end();
      return;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Database not reachable after ${attempts} attempts: ${(lastError as Error)?.message}`);
}
