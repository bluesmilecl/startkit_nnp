import { getEnv } from '@starter/config';
import { createLogger } from '@starter/observability';
import { createApp } from './create-app.js';

const log = createLogger('api');

async function main(): Promise<void> {
  const env = getEnv();
  const app = await createApp();
  await app.listen(env.API_PORT, env.API_HOST);
  log.info({ port: env.API_PORT }, 'api listening');
}

main().catch((err: unknown) => {
  log.fatal({ err: err instanceof Error ? err.message : String(err) }, 'api failed to start');
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
