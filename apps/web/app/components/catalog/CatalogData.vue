<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { Button } from '#ui/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import ActionMenu from '#ui/components/common/ActionMenu.vue';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import { ICONS } from '#ui/lib/icons';
import { formatNumber, formatUsd } from '#ui/lib/format';
import StatusBadge from '~/components/shared/StatusBadge.vue';
import CatalogExample from './CatalogExample.vue';

/** Data: indicators and a complete list (toolbar, filters, table/cards, selection, row actions). */
const notify = useNotify();

interface Order {
  id: string;
  customer: string;
  status: 'active' | 'pending' | 'archived';
  total: number;
  updatedAt: string;
}
const CUSTOMERS = ['Comercial Andes', 'Viña Los Robles', 'Transportes Sur', 'Clínica Norte', 'Ferretería Central', 'Agrícola Maule', 'Café Patagonia'];
const ALL: Order[] = Array.from({ length: 37 }, (_, i) => ({
  id: `OC-${String(1040 + i)}`,
  customer: CUSTOMERS[i % CUSTOMERS.length]!,
  status: (['active', 'pending', 'archived'] as const)[i % 3]!,
  total: Math.round(((i * 7919) % 4000) + 120) / 1,
  updatedAt: new Date(Date.UTC(2026, 9, 24, 12) - i * 5 * 3600_000).toISOString(),
}));

// In a real page the server filters, sorts and paginates (useListQuery + useAsyncData). Here the
// same state drives a local array; syncUrl is off so the catalog keeps its own ?tab=.
const list = useListQuery({ page: 1, pageSize: 10, search: '', status: undefined as string | undefined, sort: 'updatedAt', direction: 'desc' }, { syncUrl: false });
const status = list.filter('status');
const view = useViewMode('catalog-orders');
const selected = ref<string[]>([]);
const filteredRows = computed(() => {
  const q = list.query;
  const term = q.search.toLowerCase();
  const rows = ALL.filter((o) => (!q.status || o.status === q.status) && (!term || `${o.id} ${o.customer}`.toLowerCase().includes(term)));
  const key = q.sort as keyof Order;
  return rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (q.direction === 'desc' ? -1 : 1));
});
const pageRows = computed(() => filteredRows.value.slice((list.query.page - 1) * list.query.pageSize, list.query.page * list.query.pageSize));

const columns: ColumnDef<Order>[] = [
  {
    id: 'id',
    header: 'Orden',
    enableSorting: true,
    cell: ({ row }) => h('div', { class: 'flex flex-col' }, [h('span', { class: 'font-medium' }, row.original.id), h('span', { class: 'text-muted-foreground text-xs' }, row.original.customer)]),
  },
  { id: 'status', header: 'Estado', meta: { label: 'Estado' }, cell: ({ row }) => h(StatusBadge, { status: row.original.status }) },
  { id: 'total', header: 'Total', enableSorting: true, cell: ({ row }) => h('span', { class: 'tabular-nums' }, formatUsd(String(row.original.total), 2)) },
  { id: 'updatedAt', header: 'Actualizada', enableSorting: true, cell: ({ row }) => h(RelativeTime, { value: row.original.updatedAt }) },
  {
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, 'Acciones'),
    cell: ({ row }) =>
      h(ActionMenu, {
        label: `Acciones para ${row.original.id}`,
        testid: 'order-actions',
        items: [
          { label: 'Ver detalle', icon: 'view', onSelect: () => notify.info(`Detalle de ${row.original.id}`) },
          { label: 'Editar', icon: 'edit', onSelect: () => notify.info(`Editar ${row.original.id}`), testid: 'order-edit' },
          { label: 'Duplicar', icon: 'copy', onSelect: () => notify.success(`${row.original.id} duplicada`) },
          { label: row.original.status === 'archived' ? 'Restaurar' : 'Archivar', icon: row.original.status === 'archived' ? 'restore' : 'archive', separator: true, onSelect: () => notify.undo(`${row.original.id} archivada`, () => notify.info('Cambio deshecho')) },
          {
            label: 'Eliminar',
            icon: 'delete',
            destructive: true,
            testid: 'order-delete',
            confirm: { title: `¿Eliminar ${row.original.id}?`, description: 'No se puede deshacer.', confirmLabel: 'Eliminar', destructive: true },
            onSelect: () => notify.success(`${row.original.id} eliminada`),
          },
        ],
      }),
  },
];

const emptyCode = `<EmptyState title="Aún no hay registros" description="Crea el primero." :icon="ICONS.inbox">
  <Button><AppIcon name="create" /> Crear</Button>
</EmptyState>`;
const statCode = `<StatCard title="Ventas del mes" :value="formatUsd(total, 0)" :trend="0.124" trend-label="vs. mes anterior"
  :sparkline="[12, 15, 14, 18, 22, 21, 26]" :icon="ICONS.money" />
<StatCard title="Errores" :value="12" :trend="-0.3" invert-trend />   <!-- bajar es bueno -->`;
const listCode = `const list = useListQuery({ page: 1, pageSize: 20, search: '', status: undefined as string | undefined, sort: 'updatedAt', direction: 'desc' });
const status = list.filter('status');            // 'all' ⇄ undefined para el Select
const view = useViewMode('orders');              // 'table' | 'cards', recordado por navegador
const { data, status: fetch } = await useAsyncData('orders', () => unwrap(ordersList({ client: api, query: list.params.value })), { watch: [list.params] });

const columns: ColumnDef<Order>[] = [
  { id: 'id', header: 'Orden', enableSorting: true, cell: ({ row }) => row.original.id },
  { id: 'status', header: 'Estado', cell: ({ row }) => h(StatusBadge, { status: row.original.status }) },
  { id: 'actions', header: () => h('span', { class: 'sr-only' }, 'Acciones'),
    cell: ({ row }) => h(ActionMenu, { label: \`Acciones para \${row.original.id}\`, items: [
      { label: 'Editar', icon: 'edit', onSelect: () => edit(row.original) },
      { label: 'Eliminar', icon: 'delete', destructive: true, separator: true,
        confirm: { title: '¿Eliminar?', destructive: true, confirmLabel: 'Eliminar' }, onSelect: () => remove(row.original) },
    ] }) },
];

<DataToolbar v-model:search="list.search.value" v-model:view="view" placeholder="Buscar órdenes"
  :filtered="list.filtered.value" @clear="list.reset()">
  <template #filters><Select v-model="status">…</Select></template>
</DataToolbar>
<DataTable :columns="columns" :data="data?.items ?? []" :total="data?.total ?? 0" :view="view"
  :page="list.query.page" :page-size="list.query.pageSize" :page-sizes="[10, 20, 50]" :sort="list.sort.value"
  :loading="fetch === 'pending'" selectable v-model:selected="selected" caption="Órdenes"
  @update:page="list.query.page = $event" @update:page-size="list.query.pageSize = $event" @update:sort="list.setSort">
  <template #bulk="{ selected, clear }"><Button size="sm" @click="archive(selected).then(clear)">Archivar</Button></template>
  <!-- opcional: <template #card="{ row }">tarjeta propia</template> -->
</DataTable>`;
</script>

<template>
  <div class="grid gap-6">
    <CatalogExample title="StatCard" description="Indicador con tendencia (verde si mejora; invert-trend cuando bajar es bueno) y sparkline." :code="statCode">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Ventas del mes" :value="formatUsd('48210', 0)" :trend="0.124" trend-label="vs. mes anterior" :sparkline="[12, 15, 14, 18, 22, 21, 26]" :icon="ICONS.money" />
        <StatCard title="Clientes activos" :value="formatNumber(1284)" :trend="0.031" :sparkline="[40, 42, 41, 45, 47, 48, 50]" :icon="ICONS.users" />
        <StatCard title="Errores" :value="formatNumber(12)" :trend="-0.3" invert-trend trend-label="menos que ayer" :icon="ICONS.warning" />
        <StatCard title="Cargando" loading />
      </div>
    </CatalogExample>

    <CatalogExample
      id="data-list"
      title="Lista completa: DataToolbar + DataTable"
      description="Búsqueda con espera, filtros, «Limpiar», tabla o tarjetas (preferencia recordada), selección con acciones masivas, menú por fila con confirmación, orden y tamaño de página. El estado vive en useListQuery (en una página real, sincronizado con la URL)."
      :code="listCode"
    >
      <DataToolbar v-model:search="list.search.value" v-model:view="view" placeholder="Buscar por orden o cliente" :filtered="list.filtered.value" testid="orders" @clear="list.reset()">
        <template #filters>
          <Select v-model="status">
            <SelectTrigger class="w-44" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="active">Activas</SelectItem>
              <SelectItem value="pending">Pendientes</SelectItem>
              <SelectItem value="archived">Archivadas</SelectItem>
            </SelectContent>
          </Select>
        </template>
        <template #actions>
          <Button variant="outline" size="sm" @click="notify.success('Exportación lista')"><AppIcon name="export" /> Exportar</Button>
        </template>
      </DataToolbar>
      <DataTable
        v-model:selected="selected"
        :columns="columns"
        :data="pageRows"
        :total="filteredRows.length"
        :view="view"
        :page="list.query.page"
        :page-size="list.query.pageSize"
        :page-sizes="[5, 10, 20]"
        :sort="list.sort.value"
        selectable
        caption="Órdenes de compra"
        @update:page="list.query.page = $event"
        @update:page-size="list.query.pageSize = $event"
        @update:sort="list.setSort"
      >
        <template #bulk="{ selected: ids, clear }">
          <Button size="sm" variant="outline" data-testid="bulk-archive" @click="(notify.success(`${ids.length} órdenes archivadas`), clear())"><AppIcon name="archive" /> Archivar</Button>
        </template>
        <template #empty>
          <EmptyState title="Sin órdenes" description="Ninguna orden coincide con la búsqueda." :icon="ICONS.inbox" />
        </template>
      </DataTable>
    </CatalogExample>

    <CatalogExample title="EmptyState" description="Estado vacío con ícono, texto y acción." :code="emptyCode">
      <EmptyState title="Aún no hay registros" description="Crea el primero para comenzar." :icon="ICONS.inbox"><Button size="sm"><AppIcon name="create" /> Crear registro</Button></EmptyState>
    </CatalogExample>
  </div>
</template>
