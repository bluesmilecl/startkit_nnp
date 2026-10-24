<script setup lang="ts" generic="T extends Record<string, any>">
import { computed } from 'vue';
import { FlexRender, getCoreRowModel, useVueTable, type ColumnDef, type Header, type SortingState } from '@tanstack/vue-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from '@lucide/vue';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Button } from '#ui/components/ui/button';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Skeleton } from '#ui/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '#ui/components/ui/card';
import { NativeSelect, NativeSelectOption } from '#ui/components/ui/native-select';
import type { ViewMode } from '#ui/lib/kit';

/**
 * Data table on TanStack Table with server-side pagination and sorting (the server is the source
 * of truth: no client-side slicing of partial data).
 *
 * - `view="cards"` shows each row as a card (title = `cardTitle` column, actions = `actions`
 *   column, the rest as label/value pairs; override with the `card` slot). `view="auto"` uses
 *   cards below `md` and the table above.
 * - `selectable` adds checkboxes; `v-model:selected` holds row ids (kept across pages) and the
 *   `bulk` slot shows actions for them.
 * - `page-sizes` adds a page size selector (`update:pageSize`).
 * - Column labels for cards: `meta: { label }` or a string `header`.
 */
const props = withDefaults(
  defineProps<{
    columns: ColumnDef<T, any>[];
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    loading?: boolean;
    sort?: { id: string; desc: boolean } | null;
    emptyText?: string;
    rowKey?: (row: T) => string;
    caption?: string;
    view?: ViewMode | 'auto';
    cardTitle?: string;
    cardGridClass?: string;
    selectable?: boolean;
    pageSizes?: number[];
  }>(),
  { loading: false, sort: null, emptyText: 'Sin resultados', view: 'table', cardGridClass: 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3', selectable: false },
);
const emit = defineEmits<{ 'update:page': [number]; 'update:sort': [{ id: string; desc: boolean } | null]; 'update:pageSize': [number]; rowClick: [T] }>();
const selected = defineModel<string[]>('selected', { default: () => [] });

const sorting = computed<SortingState>(() => (props.sort ? [props.sort] : []));
const keyOf = (row: T, i: number) => props.rowKey?.(row) ?? String((row as { id?: string }).id ?? i);
const table = useVueTable({
  get data() {
    return props.data;
  },
  get columns() {
    return props.columns;
  },
  getCoreRowModel: getCoreRowModel(),
  manualPagination: true,
  manualSorting: true,
  getRowId: (row, i) => keyOf(row, i),
  state: {
    get sorting() {
      return sorting.value;
    },
  },
  onSortingChange: (updater) => {
    const next = typeof updater === 'function' ? updater(sorting.value) : updater;
    emit('update:sort', next[0] ?? null);
  },
});
const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.total, props.page * props.pageSize));
const colCount = computed(() => props.columns.length + (props.selectable ? 1 : 0));
const showTable = computed(() => props.view !== 'cards');
const showCards = computed(() => props.view !== 'table');

// ── cards ────────────────────────────────────────────────────────────────
const columnIds = computed(() => table.getAllLeafColumns().map((c) => c.id));
const titleId = computed(() => props.cardTitle ?? columnIds.value.find((id) => id !== 'actions'));
function labelOf(id: string): string {
  const col = table.getColumn(id);
  const def = col?.columnDef as { meta?: { label?: string }; header?: unknown } | undefined;
  return def?.meta?.label ?? (typeof def?.header === 'string' ? def.header : id);
}
const cellOf = (row: ReturnType<typeof table.getRowModel>['rows'][number], id: string) => row.getVisibleCells().find((c) => c.column.id === id);
const bodyIds = computed(() => columnIds.value.filter((id) => id !== titleId.value && id !== 'actions'));

// ── selection ────────────────────────────────────────────────────────────
const pageIds = computed(() => table.getRowModel().rows.map((r) => r.id));
const isSelected = (id: string) => selected.value.includes(id);
const allOnPage = computed<boolean | 'indeterminate'>(() => {
  const n = pageIds.value.filter(isSelected).length;
  return n === 0 ? false : n === pageIds.value.length ? true : 'indeterminate';
});
function toggleRow(id: string, on: boolean) {
  selected.value = on ? [...new Set([...selected.value, id])] : selected.value.filter((x) => x !== id);
}
function togglePage(on: boolean) {
  selected.value = on ? [...new Set([...selected.value, ...pageIds.value])] : selected.value.filter((x) => !pageIds.value.includes(x));
}
const clearSelection = () => (selected.value = []);
function onPageSize(e: Event) {
  emit('update:pageSize', Number((e.target as HTMLSelectElement).value));
}
const ariaSort = (h: Header<T, unknown>) => (h.column.getIsSorted() ? (h.column.getIsSorted() === 'desc' ? 'descending' : 'ascending') : undefined);
</script>

<template>
  <div class="space-y-3" data-slot="data-table" :data-view="view">
    <div v-if="selectable && selected.length" class="bg-muted/60 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm" role="region" aria-label="Acciones sobre la selección" data-testid="bulk-bar">
      <span class="font-medium tabular-nums" aria-live="polite">{{ selected.length }} seleccionado{{ selected.length === 1 ? '' : 's' }}</span>
      <slot name="bulk" :selected="selected" :clear="clearSelection" />
      <Button variant="ghost" size="sm" class="ml-auto" @click="clearSelection">Quitar selección</Button>
    </div>

    <!-- Table -->
    <div v-if="showTable" class="overflow-x-auto rounded-md border" :class="view === 'auto' ? 'hidden md:block' : undefined">
      <Table>
        <caption v-if="caption" class="sr-only">{{ caption }}</caption>
        <TableHeader>
          <TableRow v-for="hg in table.getHeaderGroups()" :key="hg.id">
            <TableHead v-if="selectable" class="w-10">
              <Checkbox :model-value="allOnPage" aria-label="Seleccionar las filas de esta página" :disabled="!pageIds.length" @update:model-value="(v) => togglePage(v === true)" />
            </TableHead>
            <TableHead v-for="header in hg.headers" :key="header.id" :aria-sort="ariaSort(header)">
              <button
                v-if="header.column.getCanSort()"
                type="button"
                class="hover:text-foreground inline-flex items-center gap-1"
                @click="header.column.toggleSorting(header.column.getIsSorted() === 'asc')"
              >
                <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
                <ArrowUp v-if="header.column.getIsSorted() === 'asc'" class="size-3" />
                <ArrowDown v-else-if="header.column.getIsSorted() === 'desc'" class="size-3" />
                <ArrowUpDown v-else class="size-3 opacity-50" />
              </button>
              <FlexRender v-else :render="header.column.columnDef.header" :props="header.getContext()" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="loading && !data.length">
            <TableRow v-for="i in 5" :key="i">
              <TableCell v-for="c in colCount" :key="c"><Skeleton class="h-4 w-full" /></TableCell>
            </TableRow>
          </template>
          <template v-else-if="table.getRowModel().rows.length">
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :data-testid="`row-${row.id}`"
              :data-state="selectable && isSelected(row.id) ? 'selected' : undefined"
              class="cursor-default"
              @click="emit('rowClick', row.original)"
            >
              <TableCell v-if="selectable" @click.stop>
                <Checkbox :model-value="isSelected(row.id)" :aria-label="`Seleccionar fila ${row.id}`" @update:model-value="(v) => toggleRow(row.id, v === true)" />
              </TableCell>
              <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
          </template>
          <TableRow v-else>
            <TableCell :colspan="colCount" class="text-muted-foreground h-24 text-center">
              <slot name="empty">{{ emptyText }}</slot>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Cards -->
    <div v-if="showCards" :class="view === 'auto' ? 'md:hidden' : undefined">
      <ul v-if="loading && !data.length" :class="cardGridClass" aria-hidden="true">
        <li v-for="i in 6" :key="i"><Skeleton class="h-32 w-full rounded-xl" /></li>
      </ul>
      <ul v-else-if="table.getRowModel().rows.length" :class="cardGridClass" :aria-label="caption">
        <li v-for="row in table.getRowModel().rows" :key="row.id" :data-testid="`card-${row.id}`" class="min-w-0">
          <slot name="card" :row="row.original" :selected="isSelected(row.id)" :toggle="(on: boolean) => toggleRow(row.id, on)">
            <Card class="h-full gap-3 py-4" :data-state="selectable && isSelected(row.id) ? 'selected' : undefined" @click="emit('rowClick', row.original)">
              <CardHeader class="flex flex-row items-start gap-3 px-4">
                <Checkbox v-if="selectable" class="mt-0.5" :model-value="isSelected(row.id)" :aria-label="`Seleccionar ${row.id}`" @click.stop @update:model-value="(v) => toggleRow(row.id, v === true)" />
                <div class="min-w-0 flex-1">
                  <FlexRender v-if="titleId && cellOf(row, titleId)" :render="cellOf(row, titleId)!.column.columnDef.cell" :props="cellOf(row, titleId)!.getContext()" />
                </div>
                <div v-if="cellOf(row, 'actions')" class="-mt-1 -mr-2" @click.stop>
                  <FlexRender :render="cellOf(row, 'actions')!.column.columnDef.cell" :props="cellOf(row, 'actions')!.getContext()" />
                </div>
              </CardHeader>
              <CardContent v-if="bodyIds.length" class="px-4">
                <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                  <template v-for="id in bodyIds" :key="id">
                    <dt class="text-muted-foreground">{{ labelOf(id) }}</dt>
                    <dd class="min-w-0 truncate text-right"><FlexRender :render="cellOf(row, id)!.column.columnDef.cell" :props="cellOf(row, id)!.getContext()" /></dd>
                  </template>
                </dl>
              </CardContent>
            </Card>
          </slot>
        </li>
      </ul>
      <div v-else class="text-muted-foreground rounded-md border py-10 text-center text-sm"><slot name="empty">{{ emptyText }}</slot></div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p class="text-muted-foreground" aria-live="polite">{{ from }}–{{ to }} de {{ total }}</p>
      <div class="flex items-center gap-2">
        <label v-if="pageSizes?.length" class="text-muted-foreground flex items-center gap-2">
          <span class="hidden sm:inline">Por página</span>
          <NativeSelect :model-value="String(pageSize)" class="h-8 w-20" aria-label="Filas por página" @change="onPageSize">
            <NativeSelectOption v-for="n in pageSizes" :key="n" :value="String(n)">{{ n }}</NativeSelectOption>
          </NativeSelect>
        </label>
        <Button variant="outline" size="sm" :disabled="page <= 1 || loading" aria-label="Página anterior" @click="emit('update:page', page - 1)">
          <ChevronLeft class="size-4" />
        </Button>
        <span class="tabular-nums">{{ page }} / {{ pageCount }}</span>
        <Button variant="outline" size="sm" :disabled="page >= pageCount || loading" aria-label="Página siguiente" @click="emit('update:page', page + 1)">
          <ChevronRight class="size-4" />
        </Button>
      </div>
    </div>
  </div>
</template>
