/** Flattens nested objects to dotted paths (arrays are kept as values) for readable diffs. */
export function flatten(value: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = value;
  }
  return out;
}

/** Only the paths whose values differ between two objects. */
export function changedPaths(before: unknown, after: unknown): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  return { before: Object.fromEntries(keys.map((k) => [k, a[k]])), after: Object.fromEntries(keys.map((k) => [k, b[k]])) };
}
