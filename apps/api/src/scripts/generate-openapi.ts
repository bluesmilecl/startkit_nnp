/**
 * Generates the OpenAPI artifact from the real NestJS application (no parallel document):
 *   packages/api-client/openapi.json  — consumed by the typed client generator
 *   docs/api-reference.md             — Markdown reference indexed by llms.txt
 * Usage: pnpm api:docs:generate [--check]
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Generation never touches the database or secrets; provide inert placeholders if unset.
process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString('hex');
process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.NODE_ENV ??= 'development';
process.env.LOG_LEVEL ??= 'silent';
process.env.FEATURE_ORGANIZATIONS = 'true';
process.env.FEATURE_AI = 'true';
process.env.FEATURE_RAG = 'true';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

async function main(): Promise<void> {
  const { createApp } = await import('../create-app.js');
  const { buildFullDocument } = await import('../modules/system/openapi-docs.js');
  const { AUTH } = await import('../infra/tokens.js');
  const { renderMarkdown } = await import('./openapi-markdown.js');
  const app = await createApp({ logger: false, docs: false });
  const doc = await buildFullDocument(app, app.get(AUTH));
  await app.close();
  const json = `${JSON.stringify(doc, null, 2)}\n`;
  const md = renderMarkdown(doc as never);
  const targets: [string, string][] = [
    [resolve(root, 'packages/api-client/openapi.json'), json],
    [resolve(root, 'docs/api-reference.md'), md],
  ];
  if (process.argv.includes('--check')) {
    const stale = targets.filter(([p, c]) => {
      try {
        return readFileSync(p, 'utf8') !== c;
      } catch {
        return true;
      }
    });
    if (stale.length) {
      console.error(`OpenAPI artifacts are out of date: ${stale.map(([p]) => p).join(', ')}\nRun: pnpm api:docs:generate`);
      process.exit(1);
    }
    console.log('OpenAPI artifacts are up to date');
    return;
  }
  for (const [p, c] of targets) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, c);
    console.log(`wrote ${p}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
