#!/usr/bin/env node
/**
 * Detects breaking changes between the committed OpenAPI baseline (default: origin/main) and the
 * document generated from the current code (packages/api-client/openapi.json).
 *   node scripts/contract-check.mjs [--base <git-ref>]
 * Set ALLOW_BREAKING=1 (e.g. for a planned major release) to report without failing.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const file = 'packages/api-client/openapi.json';
const baseRef = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : (process.env.CONTRACT_BASE ?? 'origin/main');
const current = JSON.parse(readFileSync(`${root}${file}`, 'utf8'));
let base;
try {
  base = JSON.parse(execSync(`git show ${baseRef}:${file}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
} catch {
  console.log(`No baseline at ${baseRef}:${file}; nothing to compare.`);
  process.exit(0);
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const breaking = [];
const resolve = (doc, s) => {
  let node = s;
  for (let i = 0; node?.$ref && i < 20; i++) node = doc.components?.schemas?.[node.$ref.split('/').pop()];
  return node ?? {};
};

/** `type` may be a string or an array (["object", "null"]); compare by value, ignoring order. */
const typeKey = (t) => [t].flat().sort().join(',');

function compareSchemas(where, oldS, newS, direction, depth = 0) {
  if (depth > 6) return;
  const o = resolve(base, oldS);
  const n = resolve(current, newS);
  if (o.type && n.type && typeKey(o.type) !== typeKey(n.type)) breaking.push(`${where}: type ${o.type} → ${n.type}`);
  if (direction === 'response') {
    for (const p of Object.keys(o.properties ?? {})) {
      if (!(p in (n.properties ?? {}))) breaking.push(`${where}: response property "${p}" removed`);
      else compareSchemas(`${where}.${p}`, o.properties[p], n.properties[p], direction, depth + 1);
    }
    for (const p of o.required ?? []) if (!(n.required ?? []).includes(p) && p in (n.properties ?? {})) breaking.push(`${where}: response property "${p}" became optional`);
  } else {
    for (const p of n.required ?? []) if (!(o.required ?? []).includes(p)) breaking.push(`${where}: request property "${p}" became required`);
    for (const p of Object.keys(n.properties ?? {})) if (o.properties?.[p]) compareSchemas(`${where}.${p}`, o.properties[p], n.properties[p], direction, depth + 1);
  }
  if (o.enum && n.enum && direction === 'request') for (const v of o.enum) if (!n.enum.includes(v)) breaking.push(`${where}: enum value "${v}" removed`);
}

for (const [path, item] of Object.entries(base.paths)) {
  for (const m of METHODS) {
    const oldOp = item[m];
    if (!oldOp) continue;
    const newOp = current.paths[path]?.[m];
    const id = `${m.toUpperCase()} ${path}`;
    if (!newOp) {
      breaking.push(`${id}: operation removed`);
      continue;
    }
    if (oldOp.operationId !== newOp.operationId) breaking.push(`${id}: operationId ${oldOp.operationId} → ${newOp.operationId}`);
    for (const p of newOp.parameters ?? []) {
      const before = (oldOp.parameters ?? []).find((x) => x.name === p.name && x.in === p.in);
      if (p.required && (!before || !before.required)) breaking.push(`${id}: parameter "${p.name}" is now required`);
    }
    const ob = oldOp.requestBody?.content?.['application/json']?.schema;
    const nb = newOp.requestBody?.content?.['application/json']?.schema;
    if (ob && nb) compareSchemas(`${id} body`, ob, nb, 'request');
    for (const [code, r] of Object.entries(oldOp.responses ?? {})) {
      if (Number(code) >= 400) continue;
      const os = r.content?.['application/json']?.schema;
      const ns = newOp.responses?.[code]?.content?.['application/json']?.schema;
      if (os && !ns) breaking.push(`${id}: response ${code} body removed`);
      else if (os && ns) compareSchemas(`${id} ${code}`, os, ns, 'response');
    }
  }
}

if (!breaking.length) {
  console.log(`API contract compatible with ${baseRef}.`);
} else {
  console.log(`Breaking API changes vs ${baseRef}:\n${breaking.map((b) => `  - ${b}`).join('\n')}`);
  if (!process.env.ALLOW_BREAKING) {
    console.log('Set ALLOW_BREAKING=1 only for a planned major version with a migration guide.');
    process.exit(1);
  }
}
