#!/usr/bin/env node
/**
 * Local development without containers for the apps (infrastructure can run in Docker):
 *   pnpm infra:up            (PostgreSQL + pgvector and Mailpit in Docker, reading the root .env)
 *   pnpm build:ts && pnpm db:migrate && pnpm dev
 * Runs: TypeScript build in watch mode, API and worker with node --watch, Nuxt dev server.
 */
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const procs = [
  ['tsc', 'pnpm exec tsc -b tsconfig.json --watch --preserveWatchOutput'],
  ['api', 'node --env-file-if-exists=.env --watch --enable-source-maps apps/api/dist/main.js'],
  ['worker', 'node --env-file-if-exists=.env --watch --enable-source-maps apps/worker/dist/main.js'],
  ['web', 'pnpm --filter @starter/web dev'],
];
const colors = ['\x1b[36m', '\x1b[35m', '\x1b[33m', '\x1b[32m'];
const children = procs.map(([name, cmd], i) => {
  const child = spawn(cmd, { cwd: root, shell: true, env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `${colors[i]}[${name}]\x1b[0m `;
  const pipe = (stream, out) => stream.on('data', (d) => out.write(String(d).replace(/^/gm, prefix)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
});
const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
