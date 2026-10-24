#!/usr/bin/env node
/**
 * `pnpm verify`: code, contracts, builds and (when infrastructure is reachable) integration.
 * Writes a reproducible summary to verify-report.md. Flags:
 *   --skip-integration   do not run tests that need PostgreSQL
 *   --with-e2e           also start the Docker stack and run Playwright (slow)
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { versions } from 'node:process';

const root = new URL('..', import.meta.url).pathname;
const args = new Set(process.argv.slice(2));
const steps = [
  ['Install (frozen lockfile)', 'pnpm install --frozen-lockfile'],
  ['TypeScript build', 'pnpm build:ts'],
  ['Lint', 'pnpm lint'],
  ['Web typecheck', 'pnpm --filter @starter/web typecheck'],
  ['Unit tests', 'pnpm test'],
  ['OpenAPI artifacts up to date', 'node apps/api/dist/scripts/generate-openapi.js --check'],
  ['Generated client compiles', 'pnpm api:client:generate && git diff --exit-code -- packages/api-client/src/generated && pnpm exec tsc -b packages/api-client'],
  ['API contract (breaking changes)', 'pnpm api:contract:check'],
  ['Manifest up to date', 'node scripts/manifest.mjs --check'],
  ['JSON Schemas up to date', 'node scripts/schemas.mjs --check'],
  ['Documentation', 'pnpm docs:check'],
  ['Compose variants', 'docker compose -f docker/compose.yaml -f docker/compose.dev.yaml --profile local-db --profile dev-mail config -q && docker compose -f docker/compose.yaml -f docker/compose.production.yaml config -q && POSTGRES_PASSWORD=x POSTGRES_APP_PASSWORD=x docker compose -f docker/compose.dokploy.yaml config -q'],
  ['Web build', 'pnpm --filter @starter/web build'],
];
if (!args.has('--skip-integration')) steps.push(['Migrations', 'pnpm db:migrate'], ['Integration tests', 'pnpm test:integration']);
if (args.has('--with-e2e')) steps.push(['E2E stack', 'node scripts/e2e-stack.mjs up'], ['E2E tests', 'pnpm test:e2e --project=chromium']);

const results = [];
let failed = false;
for (const [name, cmd] of steps) {
  const t0 = Date.now();
  process.stdout.write(`▶ ${name}… `);
  try {
    execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failed = true;
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.split('\n').slice(-25).join('\n');
    results.push({ name, ok: false, ms: Date.now() - t0, out });
    console.log('FAILED');
    console.log(out);
    break;
  }
}
if (args.has('--with-e2e')) execSync('node scripts/e2e-stack.mjs down', { cwd: root, stdio: 'inherit' });

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  } catch {
    return 'unknown';
  }
})();
const report = [
  `# Verify report`,
  '',
  `- Commit: \`${commit}\``,
  `- Node: \`${versions.node}\``,
  `- Date: ${new Date().toISOString()}`,
  '',
  '| Step | Result | Time |',
  '| --- | --- | --- |',
  ...results.map((r) => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${(r.ms / 1000).toFixed(1)}s |`),
  ...steps.slice(results.length).map(([name]) => `| ${name} | ⏭ not run | — |`),
  '',
  ...results.filter((r) => !r.ok).map((r) => `## ${r.name}\n\n\`\`\`\n${r.out}\n\`\`\``),
].join('\n');
writeFileSync(`${root}verify-report.md`, `${report}\n`);
console.log(`\nSummary written to verify-report.md`);
process.exit(failed ? 1 : 0);
