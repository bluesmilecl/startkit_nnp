import type { Client } from '@starter/api-client';
import { normalizeError, type ApiErrorBody } from '#ui/lib/errors';

export type { ApiErrorBody };

/** Access the typed API client: `adminUsersList({ client: api(), query })`. */
export function useApi(): Client {
  return useNuxtApp().$api as Client;
}

/**
 * Code, Spanish message, details and request id of anything thrown by an API call. Prefer
 * `notify.error(err)` for toasts and `normalizeError(err)` for everything else (status, title,
 * field errors, retryable); this stays for code that branches on `.code`.
 */
export function apiError(err: unknown): ApiErrorBody['error'] {
  const p = normalizeError(err);
  return { code: p.code, message: p.message, details: p.details, requestId: p.requestId };
}

/** Unwraps `{ data }` from generated SDK calls (the client is configured with throwOnError). */
export async function unwrap<R extends { data?: unknown }>(promise: Promise<R>): Promise<NonNullable<R['data']>> {
  const res = await promise;
  return res.data as NonNullable<R['data']>;
}

/** Two-way binding for nullable string fields with inputs that expect strings ('' ⇄ null). */
export function nullableModel<T extends Record<string, unknown>>(target: T, key: keyof T) {
  return computed<string>({
    get: () => (target[key] as string | null | undefined) ?? '',
    set: (v) => {
      (target as Record<string, unknown>)[key as string] = v === '' ? null : v;
    },
  });
}
