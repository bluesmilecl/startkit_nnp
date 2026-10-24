#!/usr/bin/env node
/**
 * Writes the versioned JSON Schemas used by editors and CI:
 *   docs/schemas/starter.config.schema.json   (from the Zod schema in @starter/config)
 *   docs/schemas/starter.manifest.schema.json (shape of starter.manifest.json)
 * `--check` fails when the committed files are stale. Requires `pnpm build:ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { starterConfigJsonSchema } = await import(join(root, 'packages/config/dist/starter-config.js'));

const { $schema: _ignored, ...generated } = starterConfigJsonSchema();
const config = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://starter.local/schemas/starter.config.schema.json',
  title: 'starter.config.json',
  description: 'Configuración exportable del proyecto. Nunca contiene secretos ni cadenas de conexión: solo referencias.',
  ...generated,
};

const str = { type: 'string' };
const manifest = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://starter.local/schemas/starter.manifest.schema.json',
  title: 'starter.manifest.json',
  description: 'Versiones exactas del stack, política de runtime e imágenes. Generado por scripts/manifest.mjs.',
  type: 'object',
  required: ['name', 'version', 'runtime', 'stack', 'images', 'modules'],
  properties: {
    $schema: str,
    name: str,
    version: str,
    generatedBy: str,
    runtime: {
      type: 'object',
      required: ['node', 'packageManager', 'postgres'],
      properties: {
        node: { type: 'object', required: ['lts', 'supported'], properties: { lts: str, supported: { type: 'array', items: str }, testedCurrent: { type: 'array', items: str } } },
        packageManager: str,
        postgres: { type: 'object', properties: { version: str, pgvector: str } },
      },
    },
    stack: { type: 'object', additionalProperties: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' } },
    images: { type: 'array', items: { type: 'string', not: { pattern: ':latest$' } } },
    modules: { type: 'object', additionalProperties: { enum: ['optional', 'default-on', 'required'] } },
  },
};

const outputs = {
  'docs/schemas/starter.config.schema.json': config,
  'docs/schemas/starter.manifest.schema.json': manifest,
};
const check = process.argv.includes('--check');
let stale = false;
mkdirSync(join(root, 'docs/schemas'), { recursive: true });
for (const [file, data] of Object.entries(outputs)) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const path = join(root, file);
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
      console.error(`${file} is stale; run node scripts/schemas.mjs`);
      stale = true;
    }
  } else writeFileSync(path, text);
}
if (stale) process.exit(1);
console.log(check ? 'Schemas up to date' : 'Schemas written');
