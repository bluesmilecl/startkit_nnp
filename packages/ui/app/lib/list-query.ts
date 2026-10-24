/**
 * Pure helpers behind useListQuery: typed list state <-> URL query string. The type of each key
 * comes from its default value (number, boolean or string; `undefined` means optional string).
 */
export type ListQueryValue = string | number | boolean | undefined;
export type ListQueryDefaults = Record<string, ListQueryValue>;

type RawQuery = Record<string, unknown>;

function first(v: unknown): string | undefined {
  if (Array.isArray(v)) return first(v[0]);
  if (v === null || v === undefined) return undefined;
  return String(v);
}

/** Reads `raw` (route.query) into a state shaped and typed like `defaults`. Unknown keys are ignored. */
export function parseListQuery<T extends ListQueryDefaults>(raw: RawQuery, defaults: T): T {
  const out: Record<string, ListQueryValue> = {};
  for (const [key, def] of Object.entries(defaults)) {
    const value = first(raw[key]);
    if (value === undefined || value === '') {
      out[key] = def;
    } else if (typeof def === 'number') {
      const n = Number(value);
      out[key] = Number.isFinite(n) ? n : def;
    } else if (typeof def === 'boolean') {
      out[key] = value === 'true' || value === '1';
    } else {
      out[key] = value;
    }
  }
  if (typeof out.page === 'number') out.page = Math.max(1, Math.floor(out.page));
  if (typeof out.pageSize === 'number') out.pageSize = Math.min(200, Math.max(1, Math.floor(out.pageSize)));
  return out as T;
}

/** Query string for the URL: only values that differ from their default (clean, shareable links). */
export function serializeListQuery<T extends ListQueryDefaults>(state: T, defaults: T): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(defaults)) {
    const v = state[key];
    out[key] = v === undefined || v === '' || v === defaults[key] ? undefined : String(v);
  }
  return out;
}

/** Parameters for the API call: drops empty values. */
export function listQueryParams<T extends ListQueryDefaults>(state: T): Partial<T> {
  const out: Record<string, ListQueryValue> = {};
  for (const [key, v] of Object.entries(state)) if (v !== undefined && v !== '') out[key] = v;
  return out as Partial<T>;
}

/** Keys whose change should send the list back to page 1 (everything except page). */
export function changedFilterKeys<T extends ListQueryDefaults>(next: T, prev: T): string[] {
  return Object.keys(next).filter((k) => k !== 'page' && next[k] !== prev[k]);
}
