import { computed, watch, type ComputedRef } from 'vue';
import { createError, showError, useAsyncData, type AsyncData, type AsyncDataOptions, type NuxtError } from '#app';
import { normalizeError, type Problem } from '#ui/lib/errors';

export interface ApiDataOptions<T> extends AsyncDataOptions<T> {
  /**
   * Statuses that replace the whole page with the error page (error.vue) instead of an inline
   * LoadError: typically `[404]` on detail pages (`/admin/users/<unknown id>`).
   */
  fatal?: number[];
}

export type ApiData<T> = Awaited<AsyncData<T | undefined, NuxtError | undefined>> & {
  /** Normalized error of the last load (null while there is none). */
  problem: ComputedRef<Problem | null>;
};

/**
 * `useAsyncData` with the starter's error conventions. Always `await` it in `<script setup>`:
 *
 *   const { data: user, problem, refresh } = await useApiData(`user-${id}`, () => unwrap(adminUsersGet({ client: api, path: { id } })), { fatal: [404] });
 *
 *   <LoadError v-if="problem" :error="problem" @retry="refresh()" />
 *
 * A fatal status throws a NuxtError with the API problem in `data`, so SSR answers with that
 * status and error.vue shows the Spanish message and request id.
 */
export function useApiData<T>(key: string | (() => string), handler: () => Promise<T>, options: ApiDataOptions<T> = {}): ApiData<T> & Promise<ApiData<T>> {
  const { fatal = [], ...rest } = options;
  const asyncData = useAsyncData(key, handler, rest as AsyncDataOptions<T>);
  const problem = computed(() => (asyncData.error.value ? normalizeError(asyncData.error.value) : null));
  const fatalProblem = () => (problem.value && fatal.includes(problem.value.status) ? problem.value : null);
  let settled = false;
  if (import.meta.client && fatal.length) {
    // Later loads (refresh, watched params) that hit a fatal status also replace the page.
    watch(problem, () => {
      const p = settled ? fatalProblem() : null;
      if (p) void showError(toNuxtError(p));
    });
  }
  const { data, pending, status, error, refresh, execute, clear } = asyncData;
  const fields = { data, pending, status, error, refresh, execute, clear, problem };
  const ready = asyncData.then(() => {
    settled = true;
    const p = fatalProblem();
    if (p) throw createError(toNuxtError(p));
    return fields;
  });
  // Same shape as useAsyncData's return (refs on the promise), plus `problem`. Only the fields are
  // copied: Nuxt's promise carries its own enumerable then/catch, which would bypass `ready`.
  return Object.assign(ready, fields) as unknown as ApiData<T> & Promise<ApiData<T>>;
}

function toNuxtError(p: Problem) {
  return { statusCode: p.status, statusMessage: p.title, message: p.message, fatal: true, data: { error: { code: p.code, message: p.message, requestId: p.requestId } } };
}
