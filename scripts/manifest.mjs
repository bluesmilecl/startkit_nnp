#!/usr/bin/env node
/**
 * Writes starter.manifest.json: exact versions of the stack (from workspace package.json files),
 * runtime policy and container images. `--check` fails when the committed file is stale.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const rootPkg = read('package.json');

const TRACKED = [
  'nuxt', 'vue', '@nestjs/core', '@nestjs/swagger', 'ai', '@ai-sdk/vue', '@ai-sdk/openai', '@ai-sdk/anthropic',
  '@ai-sdk/google', '@ai-sdk/openai-compatible', 'better-auth', 'drizzle-orm', 'drizzle-kit', 'pg-boss', 'zod',
  'shadcn-nuxt', 'reka-ui', 'tailwindcss', '@unovis/vue', 'typescript', 'vitest', '@playwright/test', '@hey-api/openapi-ts',
];

const versions = {};
const dirs = ['apps', 'packages', 'tooling'].flatMap((d) =>
  existsSync(join(root, d)) ? readdirSync(join(root, d)).map((n) => `${d}/${n}/package.json`) : [],
);
for (const file of ['package.json', ...dirs]) {
  if (!existsSync(join(root, file))) continue;
  const pkg = read(file);
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    for (const [name, v] of Object.entries(deps ?? {})) {
      if (TRACKED.includes(name) && !String(v).startsWith('workspace:')) versions[name] = String(v);
    }
  }
}

const compose = existsSync(join(root, 'docker/compose.yaml')) ? readFileSync(join(root, 'docker/compose.yaml'), 'utf8') : '';
const images = [...compose.matchAll(/image:\s*["']?([^\s"']+)/g)].map((m) => m[1]).filter((i) => !i.startsWith('${'));

const manifest = {
  $schema: './docs/schemas/starter.manifest.schema.json',
  name: 'starter-kit',
  version: rootPkg.version,
  generatedBy: 'scripts/manifest.mjs',
  runtime: {
    node: { lts: readFileSync(join(root, '.node-version'), 'utf8').trim(), supported: ['24'], testedCurrent: ['26'] },
    packageManager: rootPkg.packageManager,
    postgres: { version: '18', pgvector: '0.8.7' },
  },
  stack: Object.fromEntries(Object.entries(versions).sort(([a], [b]) => a.localeCompare(b))),
  images: [...new Set(images)].sort(),
  modules: { organizations: 'optional', ai: 'default-on', rag: 'optional' },
};
const out = `${JSON.stringify(manifest, null, 2)}\n`;
const target = join(root, 'starter.manifest.json');
if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
    console.error('starter.manifest.json is out of date. Run: node scripts/manifest.mjs');
    process.exit(1);
  }
  console.log('starter.manifest.json is up to date');
} else {
  writeFileSync(target, out);
  console.log(`wrote ${target}`);
}
