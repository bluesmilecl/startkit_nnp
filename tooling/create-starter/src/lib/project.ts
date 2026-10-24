import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CliError } from './ui.js';

/** Root of a starter project: the directory holding starter.manifest.json. */
export function findRoot(from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'starter.manifest.json')) && existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new CliError('No estás dentro de un proyecto del starter (no se encontró starter.manifest.json)');
    dir = parent;
  }
}

/** Loads <root>/.env without overriding variables already set in the shell. */
export function loadEnv(root: string): boolean {
  const file = join(root, '.env');
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Domain services for the operational commands, built exactly as the worker builds them
 * (same packages, same database, same secrets). Imported lazily so `create` runs without them.
 */
export async function projectContext() {
  const root = findRoot();
  loadEnv(root);
  const config = await import('@starter/config');
  let env: import('@starter/config').Env;
  try {
    env = config.parseEnv(process.env);
  } catch (err) {
    throw new CliError(`Configuración de entorno inválida: ${(err as Error).message}\nEjecuta "pnpm starter doctor" para ver el detalle.`);
  }
  const { createDb } = await import('@starter/db');
  const { createMailer } = await import('@starter/mail');
  const { createStorage } = await import('@starter/storage');
  const handle = createDb(env.DATABASE_URL, { max: 2, ssl: env.DATABASE_SSL, applicationName: 'starter-cli' });
  const deps = {
    db: handle.db,
    env,
    features: config.featureFlags(env),
    mailer: createMailer(env),
    secrets: new config.SecretBox(env.APP_ENCRYPTION_KEY, env.APP_ENCRYPTION_PREVIOUS_KEYS),
    storage: createStorage(env),
  };
  return { root, env, handle, deps, close: () => handle.close() };
}
export type ProjectContext = Awaited<ReturnType<typeof projectContext>>;
