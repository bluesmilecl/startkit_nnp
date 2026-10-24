#!/usr/bin/env node
/**
 * Documentation integrity:
 *  - relative links in Markdown files point to existing files
 *  - every file listed in llms.txt exists
 *  - `pnpm <script>` commands mentioned in docs exist in package.json
 *  - starter.config.example.json validates against the versioned schema
 *  - AI SDK docs references match the installed major version
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const errors = [];
const SKIP = new Set(['node_modules', '.git', 'dist', '.nuxt', '.output', 'playwright-report', 'test-results', 'generated']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts));
const builtins = new Set(['install', 'add', 'exec', 'dlx', 'create', 'run', 'dev', 'build', 'test', '--filter', 'approve-builds', 'update', 'outdated', 'audit']);
const mdFiles = walk(root).filter((f) => !f.includes(`${join('packages', 'ui', 'app', 'components', 'ui')}`));

for (const file of mdFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target) continue;
    if (!existsSync(resolve(dirname(file), target))) errors.push(`${relative(root, file)}: broken link ${m[1]}`);
  }
  for (const m of text.matchAll(/`pnpm ([a-z][\w:-]*)/g)) {
    const s = m[1];
    if (!scripts.has(s) && !builtins.has(s)) errors.push(`${relative(root, file)}: unknown command "pnpm ${s}"`);
  }
}

const llms = join(root, 'llms.txt');
if (existsSync(llms)) {
  for (const m of readFileSync(llms, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    if (!/^https?:/.test(m[1]) && !existsSync(join(root, m[1]))) errors.push(`llms.txt: missing ${m[1]}`);
  }
} else errors.push('llms.txt missing');

const example = join(root, 'starter.config.example.json');
if (existsSync(example)) {
  const { validateStarterConfig } = await import(join(root, 'packages/config/dist/starter-config.js'));
  const r = validateStarterConfig(JSON.parse(readFileSync(example, 'utf8')));
  if (!r.ok) errors.push(`starter.config.example.json invalid: ${JSON.stringify(r.errors)}`);
} else errors.push('starter.config.example.json missing');

const aiMajor = (pkg.devDependencies?.ai ?? JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8')).dependencies.ai)?.split('.')[0];
const aiDoc = join(root, 'docs/agents-and-chat.md');
if (existsSync(aiDoc) && aiMajor && !readFileSync(aiDoc, 'utf8').includes(`AI SDK ${aiMajor}`)) {
  errors.push(`docs/agents-and-chat.md does not state the installed AI SDK major (${aiMajor})`);
}

if (errors.length) {
  console.error(`Documentation check failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`Documentation check passed (${mdFiles.length} Markdown files).`);
