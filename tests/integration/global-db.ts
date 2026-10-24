import pg from 'pg';

/** Recreates an isolated database for the integration run (never the development database). */
export async function recreateTestDatabase(baseUrl: string): Promise<string> {
  const url = new URL(baseUrl);
  const name = process.env.TEST_DATABASE_NAME ?? `${url.pathname.slice(1) || 'starter'}_it`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [name]);
    await admin.query(`drop database if exists "${name}"`);
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  url.pathname = `/${name}`;
  return url.toString();
}
