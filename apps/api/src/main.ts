import { getEnv } from '@starter/config';
import { createLogger, installProcessHandlers, sanitizeError } from '@starter/observability';
import { createApp } from './create-app.js';

const log = createLogger('api');
installProcessHandlers(log);

async function main(): Promise<void> {
  const env = getEnv();
  const app = await createApp();
  await app.listen(env.API_PORT, env.API_HOST);
  log.info({ port: env.API_PORT }, 'api listening');
}

main().catch((err: unknown) => {
  log.fatal({ err: sanitizeError(err, 4000), stack: err instanceof Error ? err.stack : undefined }, 'api failed to start');
  process.exit(1);
});
