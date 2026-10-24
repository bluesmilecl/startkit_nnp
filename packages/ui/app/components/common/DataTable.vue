<script setup lang="ts" generic="T extends Record<string, any>">
import { computed } from 'vue';
import { FlexRender, getCoreRowModel, useVueTable, type ColumnDef, type SortingState } from '@tanstack/vue-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from '@lucide/vue';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Button } from '#ui/components/ui/button';
import { Skeleton } from '#ui/components/ui/skeleton';

/**
 * Data table on TanStack Table with server-side pagination and sorting (the server is the source
 * of truth: no client-side slicing of partial data).
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
  }>(),
  { loading: false, sort: null, emptyText: 'Sin resultados' },
);
const emit = defineEmits<{ 'update:page': [number]; 'update:sort': [{ id: string; desc: boolean } | null]; rowClick: [T] }>();

const sorting = computed<SortingState>(() => (props.sort ? [props.sort] : []));
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
  getRowId: (row, i) => props.rowKey?.(row) ?? String((row as { id?: string }).id ?? i),
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
</script>

<template>
  <div class="space-y-3">
    <div class="overflow-x-auto rounded-md border">
      <Table>
        <caption v-if="caption" class="sr-only">{{ caption }}</caption>
        <TableHeader>
          <TableRow v-for="hg in table.getHeaderGroups()" :key="hg.id">
            <TableHead v-for="header in hg.headers" :key="header.id" :aria-sort="header.column.getIsSorted() ? (header.column.getIsSorted() === 'desc' ? 'descending' : 'ascending') : undefined">
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
              <TableCell v-for="c in columns.length" :key="c"><Skeleton class="h-4 w-full" /></TableCell>
            </TableRow>
          </template>
          <template v-else-if="table.getRowModel().rows.length">
            <TableRow
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :data-testid="`row-${row.id}`"
              class="cursor-default"
              @click="emit('rowClick', row.original)"
            >
              <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </TableCell>
            </TableRow>
          </template>
          <TableRow v-else>
            <TableCell :colspan="columns.length" class="text-muted-foreground h-24 text-center">{{ emptyText }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <div class="flex items-center justify-between gap-2 text-sm">
      <p class="text-muted-foreground" aria-live="polite">{{ from }}–{{ to }} de {{ total }}</p>
      <div class="flex items-center gap-2">
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
