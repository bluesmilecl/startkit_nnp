import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { inlineSchema, refOrInline, zodComponentSchemas } from './openapi-zod.js';

describe('zod → OpenAPI adapter', () => {
  const Item = z.object({ id: z.uuid(), name: z.string() }).meta({ id: 'TestItem' });
  // Registered for the component test below (meta id side effect).
  z.object({ name: z.string().min(1), tags: z.array(z.string()).default([]) }).meta({ id: 'TestItemInput' });

  it('references registered schemas as components', () => {
    expect(refOrInline(Item, 'output')).toEqual({ $ref: '#/components/schemas/TestItem' });
  });

  it('inlines unregistered schemas and points nested registered schemas to components', () => {
    const wrapper = z.object({ item: Item, count: z.number().int() });
    const json = inlineSchema(wrapper, 'output') as { properties: { item: { $ref?: string }; count: Record<string, unknown> } };
    expect(json.properties.item.$ref).toBe('#/components/schemas/TestItem');
    expect(json.properties.count.minimum).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('#/definitions');
  });

  it('uses the input shape for *Input components (defaults are optional)', () => {
    const components = zodComponentSchemas();
    const input = components.TestItemInput as { required?: string[] };
    expect(input.required).toEqual(['name']);
    expect(components.TestItem).toBeDefined();
    expect(JSON.stringify(components.TestItem)).not.toContain('$id');
  });
});
