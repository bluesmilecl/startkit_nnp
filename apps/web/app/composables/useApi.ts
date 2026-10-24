import type { Client } from '@starter/api-client';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

/** Access the typed API client: `adminUsersList({ client: api(), query })`. */
export function useApi(): Client {
  return useNuxtApp().$api as Client;
}

/** Normalizes errors thrown by the generated client (ErrorResponse body) or by fetch. */
export function apiError(err: unknown): ApiErrorBody['error'] {
  const body = err as Partial<ApiErrorBody> | undefined;
  if (body?.error?.message) return body.error;
  const e = err as { message?: string; code?: string };
  return { code: e?.code ?? 'NETWORK', message: e?.message ?? 'No se pudo completar la solicitud' };
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
