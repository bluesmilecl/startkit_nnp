import { featureFlags, getEnv, SecretBox } from '@starter/config';
import { createDb, sql, waitForDatabase } from '@starter/db';
import { JobQueue } from '@starter/jobs';
import { createMailer } from '@starter/mail';
import { createLogger, installProcessHandlers, sanitizeError } from '@starter/observability';
import { createStorage } from '@starter/storage';
import { createServer } from 'node:http';
import type { WorkerContext } from './context.js';
import { registerStorageHandlers } from './handlers/storage.js';
import { registerSystemHandlers } from './handlers/system.js';
import { registerModuleHandlers } from './modules.js';

const log = createLogger('worker');
installProcessHandlers(log);

async function main(): Promise<void> {
  const env = getEnv();
  await waitForDatabase(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
  const db = createDb(env.DATABASE_URL, { max: env.DATABASE_POOL_MAX, ssl: env.DATABASE_SSL, applicationName: 'starter-worker' });
  const jobs = await JobQueue.create({ connectionString: env.DATABASE_URL, role: 'worker' });
  const ctx: WorkerContext = {
    env,
    features: featureFlags(env),
    db,
    jobs,
    mailer: createMailer(env),
    storage: createStorage(env),
    secrets: new SecretBox(env.APP_ENCRYPTION_KEY, env.APP_ENCRYPTION_PREVIOUS_KEYS),
  };
  await registerSystemHandlers(ctx);
  await registerStorageHandlers(ctx);
  await registerModuleHandlers(ctx);
  await jobs.ensureSchedules();

  let stopping = false;
  const server = createServer(async (req, res) => {
    if (req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/health/ready') {
      try {
        await db.db.execute(sql`select 1`);
        res.writeHead(stopping ? 503 : 200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: stopping ? 'stopping' : 'ok' }));
      } catch {
        res.writeHead(503).end(JSON.stringify({ status: 'error' }));
      }
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(env.WORKER_HEALTH_PORT, '0.0.0.0');
  log.info({ healthPort: env.WORKER_HEALTH_PORT, features: ctx.features }, 'worker started');

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'stopping worker: waiting for active jobs to reach a safe point');
    await jobs.stop(true);
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  log.fatal({ err: sanitizeError(err, 4000), stack: err instanceof Error ? err.stack : undefined }, 'worker failed to start');
  process.exit(1);
});
