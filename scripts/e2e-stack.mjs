#!/usr/bin/env node
/**
 * Full Docker stack for Playwright: web + api + worker + PostgreSQL/pgvector + Mailpit, plus the
 * RAG test infrastructure (external PostgreSQL/pgvector and the retrieval API test double).
 *   node scripts/e2e-stack.mjs up|down|logs
 * Uses its own compose project and .env.e2e so it never touches the development stack.
 * Extra docker build flags (proxy, CA secret, base image mirror) can be passed with E2E_BUILD_ARGS.
 */
import { execSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const project = process.env.E2E_PROJECT ?? 'starter-e2e';
const port = process.env.E2E_PORT ?? '8080';
const mailPort = process.env.E2E_MAIL_PORT ?? '8025';
const envFile = `${root}.env.e2e`;
const compose = (args) =>
  `docker compose -p ${project} --env-file ${envFile} -f docker/compose.yaml -f docker/compose.dev.yaml --profile local-db --profile dev-mail --profile rag-db ${args}`;
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, STARTER_ENV_FILE: '../.env.e2e' } });

function writeEnv() {
  if (existsSync(envFile) && process.env.E2E_KEEP_ENV) return;
  const lines = {
    // test mode: strict response-contract validation, no auth rate limiting (OTP cooldown still applies)
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    APP_URL: `http://localhost:${port}`,
    PROXY_PORT: port,
    MAILPIT_PORT: mailPort,
    MAILPIT_SMTP_PORT: process.env.E2E_MAIL_SMTP_PORT ?? '51025',
    POSTGRES_PORT: process.env.E2E_PG_PORT ?? '55433',
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    POSTGRES_USER: 'starter',
    POSTGRES_PASSWORD: randomBytes(12).toString('hex'),
    POSTGRES_DB: 'starter',
    POSTGRES_APP_USER: 'starter_app',
    POSTGRES_APP_PASSWORD: randomBytes(12).toString('hex'),
    RAG_POSTGRES_PASSWORD: randomBytes(12).toString('hex'),
    RETRIEVAL_TEST_TOKEN: randomBytes(12).toString('hex'),
    OWNER_EMAIL: 'owner@e2e.test',
    REGISTRATION_MODE: 'invite-only',
    MAIL_TRANSPORT: 'smtp',
    MAIL_FROM: 'Starter E2E <no-reply@e2e.test>',
    OTP_RESEND_SECONDS: '20',
    DEMO_LOGIN_EMAIL: 'demo@e2e.test',
    // The deterministic provider runs the real tool-execution path without paid keys.
    AI_TEST_PROVIDER_ENABLED: 'true',
    FEATURE_ORGANIZATIONS: 'false',
    FEATURE_AI: 'true',
    FEATURE_RAG: 'true',
    RAG_FETCH_ALLOW_PRIVATE: 'true',
    OPENAPI_DOCS: 'protected',
  };
  writeFileSync(envFile, `${Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
}

async function waitHealthy(url, seconds = 180) {
  for (let i = 0; i < seconds; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const cmd = process.argv[2];
if (cmd === 'up') {
  writeEnv();
  const buildArgs = process.env.E2E_BUILD_ARGS ?? '';
  if (!process.env.E2E_SKIP_BUILD) {
    for (const s of ['api', 'worker', 'web']) run(`docker build ${buildArgs} -f docker/${s}.Dockerfile -t starter/${s}:local .`);
  }
  run(compose('up -d --no-build --wait --wait-timeout 240'));
  await waitHealthy(`http://localhost:${port}/api/health/ready`);
  console.log(`E2E stack ready on http://localhost:${port} (Mailpit http://localhost:${mailPort})`);
} else if (cmd === 'down') {
  if (existsSync(envFile)) run(compose('down -v --remove-orphans'));
} else if (cmd === 'logs') {
  spawnSync('sh', ['-c', compose('logs --no-color --tail=300')], { cwd: root, stdio: 'inherit', env: { ...process.env, STARTER_ENV_FILE: '../.env.e2e' } });
} else {
  console.error('usage: node scripts/e2e-stack.mjs up|down|logs');
  process.exit(2);
}
