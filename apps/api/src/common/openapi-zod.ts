import { z } from 'zod';

const COMPONENT_PREFIX = '#/components/schemas/';
const SAFE_INT = 9007199254740991;

type Json = Record<string, unknown>;

function cleanup(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(cleanup);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (k === '$id' || k === '$schema') continue;
    if ((k === 'minimum' && v === -SAFE_INT) || (k === 'maximum' && v === SAFE_INT)) continue;
    out[k] = cleanup(v);
  }
  return out;
}

function registryId(schema: z.ZodType): string | undefined {
  const meta = z.globalRegistry.get(schema) as { id?: string } | undefined;
  return meta?.id;
}

/** Returns `$ref` for registered schemas (meta id), otherwise an inline OpenAPI 3.0 schema. */
export function refOrInline(schema: z.ZodType, io: 'input' | 'output'): Json {
  const id = registryId(schema);
  if (id) return { $ref: `${COMPONENT_PREFIX}${id}` };
  return inlineSchema(schema, io);
}

export function inlineSchema(schema: z.ZodType, io: 'input' | 'output'): Json {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
    reused: 'inline',
    cycles: 'ref',
  }) as Json;
  return cleanup(json) as Json;
}

/**
 * Builds `components.schemas` from every schema registered with `.meta({ id })` in the shared
 * contracts. Request DTOs (ids ending with Input/Query) use the input shape, everything else the
 * wire (output) shape.
 */
export function zodComponentSchemas(): Record<string, Json> {
  const opts = { target: 'openapi-3.0' as const, unrepresentable: 'any' as const, uri: (id: string) => `${COMPONENT_PREFIX}${id}` };
  const output = z.toJSONSchema(z.globalRegistry, { ...opts, io: 'output' }) as { schemas: Record<string, Json> };
  const input = z.toJSONSchema(z.globalRegistry, { ...opts, io: 'input' }) as { schemas: Record<string, Json> };
  const result: Record<string, Json> = {};
  for (const [id, s] of Object.entries(output.schemas)) {
    const useInput = /(Input|Query)$/.test(id);
    result[id] = cleanup(useInput ? (input.schemas[id] ?? s) : s) as Json;
  }
  return result;
}
