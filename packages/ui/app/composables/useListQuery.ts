import { computed, reactive, ref, watch } from 'vue';
import { changedFilterKeys, listQueryParams, parseListQuery, serializeListQuery, type ListQueryDefaults } from '#ui/lib/list-query';

/**
 * State of a server-side list (page, page size, search, sort and filters) synced with the URL, so
 * lists survive reloads and can be shared. Changing anything but the page goes back to page 1.
 *
 *   const list = useListQuery({ page: 1, pageSize: 20, search: '', status: undefined as string | undefined, sort: 'updatedAt', direction: 'desc' });
 *   const { data, status } = await useAsyncData('customers', () => unwrap(customersList({ client: api, query: list.params.value })), { watch: [list.params] });
 *
 *   <DataToolbar v-model:search="list.search.value" … />
 *   <DataTable :page="list.query.page" :page-size="list.query.pageSize" :sort="list.sort.value"
 *     @update:page="list.query.page = $event" @update:sort="list.setSort" … />
 *
 * `search` is a debounced copy of `query.search` for the input; `filter(key)` is a two-way model
 * for selects where `all` means "no filter".
 */
export function useListQuery<T extends ListQueryDefaults>(defaults: T, options: { debounce?: number; syncUrl?: boolean } = {}) {
  const route = useRoute();
  const router = useRouter();
  const syncUrl = options.syncUrl ?? true;
  const query = reactive(parseListQuery(syncUrl ? route.query : {}, defaults)) as T;

  // Debounced search input bound to the text field.
  const search = ref(typeof query.search === 'string' ? query.search : '');
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(search, (v) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = query as Record<string, unknown>;
      if (!('search' in q) || q.search === v.trim()) return;
      q.search = v.trim();
      if ('page' in q) q.page = 1;
    }, options.debounce ?? 300);
  });

  watch(
    () => ({ ...query }),
    (next, prev) => {
      if ('page' in query && changedFilterKeys(next, prev).length && query.page !== 1) {
        (query as Record<string, unknown>).page = 1;
        return; // the page change re-runs this watcher
      }
      if (syncUrl) void router.replace({ query: { ...route.query, ...serializeListQuery({ ...query }, defaults) } });
    },
  );

  /** Sort for DataTable (`{ id, desc }`), from the `sort` and `direction` keys. */
  const sort = computed(() => (typeof query.sort === 'string' && query.sort ? { id: query.sort, desc: query.direction !== 'asc' } : null));
  function setSort(next: { id: string; desc: boolean } | null) {
    const q = query as Record<string, unknown>;
    q.sort = next?.id ?? defaults.sort;
    q.direction = next ? (next.desc ? 'desc' : 'asc') : defaults.direction;
  }

  /** Two-way model for a filter select: `all` (or the given value) maps to `undefined`. */
  function filter<K extends keyof T & string>(key: K, allValue = 'all') {
    return computed<string>({
      get: () => (query[key] === undefined ? allValue : String(query[key])),
      set: (v) => {
        const q = query as Record<string, unknown>;
        q[key] = v === allValue ? undefined : v;
        if ('page' in q) q.page = 1;
      },
    });
  }

  function reset() {
    Object.assign(query, defaults);
    search.value = typeof defaults.search === 'string' ? defaults.search : '';
  }

  /** True when any filter or search differs from its default (to show "Limpiar filtros"). */
  const filtered = computed(() => Object.keys(defaults).some((k) => !['page', 'pageSize', 'sort', 'direction'].includes(k) && query[k] !== defaults[k]));
  /** Parameters for the API call (empty values dropped); reactive, use it in `watch`. */
  const params = computed(() => listQueryParams({ ...query }));

  return { query, search, sort, setSort, filter, reset, filtered, params };
}
