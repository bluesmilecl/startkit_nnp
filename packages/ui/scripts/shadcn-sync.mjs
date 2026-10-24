#!/usr/bin/env node
/**
 * Vendors shadcn-vue registry components into app/components/ui (same result as
 * `shadcn-vue add`, which cannot reach the registry through some corporate proxies).
 *
 *   node scripts/shadcn-sync.mjs [--diff] [component ...]
 *
 * --diff only reports components whose upstream source differs from the local copy, which is
 * the first step of the update recipe in docs/frontend-components.md (local customizations
 * must be reviewed by hand before overwriting).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = process.env.SHADCN_REGISTRY ?? 'https://shadcn-vue.com/r';
const STYLE = 'new-york-v4';
// `form` targets zod 3 through @vee-validate/zod; this starter uses zod 4 + the `field` component.
const EXCLUDED = new Set(['form']);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'app/components/ui');

const args = process.argv.slice(2);
const diffOnly = args.includes('--diff');
const requested = args.filter((a) => !a.startsWith('--'));

function rewrite(content) {
  return content
    .replace(/from (["'])cn\1/g, 'from $1#ui/lib/utils$1')
    .replace(/@\/registry\/new-york-v4\/ui\//g, '#ui/components/ui/')
    .replace(/@\/registry\/new-york-v4\/lib\//g, '#ui/lib/')
    .replace(/@\/lib\/utils/g, '#ui/lib/utils');
}

async function getJson(path) {
  const res = await fetch(`${REGISTRY}/${path}`);
  if (!res.ok) throw new Error(`${res.status} ${REGISTRY}/${path}`);
  return res.json();
}

const index = await getJson('index.json');
const names = (requested.length ? requested : index.filter((i) => i.type === 'registry:ui').map((i) => i.name)).filter((n) => !EXCLUDED.has(n));
const deps = new Set();
const changed = [];
for (const name of names) {
  const item = await getJson(`styles/${STYLE}/${name}.json`);
  for (const d of item.dependencies ?? []) deps.add(d);
  for (const file of item.files ?? []) {
    const rel = file.path.replace(/^registry\/new-york-v4\/ui\//, '');
    const target = join(outDir, rel);
    const content = rewrite(file.content);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current !== content) changed.push(rel);
    if (!diffOnly) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  }
}
console.log(`${diffOnly ? 'differs from upstream' : 'written'}: ${changed.length} file(s)`);
for (const c of changed) console.log(`  ${c}`);
console.log(`npm dependencies referenced: ${[...deps].sort().join(', ')}`);
