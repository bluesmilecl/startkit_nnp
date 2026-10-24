<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { mailDeliveriesList, mailDeliveriesRetry, type MailDelivery } from '@starter/api-client';
import { Send } from '@lucide/vue';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import ActionMenu from '#ui/components/common/ActionMenu.vue';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';
import { DELIVERY_CATEGORIES, MAIL_PROVIDERS } from '~/utils/mail-labels';

/** Delivery log: every e-mail the platform sent, with the provider's answer. */
definePageMeta({ permission: 'mail.read' });
useHead({ title: 'Envíos de correo' });

const api = useApi();
const can = useCan();
const notify = useNotify();
const list = useListQuery({ page: 1, pageSize: 25, search: '', status: undefined as MailDelivery['status'] | undefined, automationId: undefined as string | undefined });
const statusFilter = list.filter('status');
const { data, status, refresh, problem } = await useApiData('mail-deliveries', () => unwrap(mailDeliveriesList({ client: api, query: list.params.value })), { watch: [list.params] });

async function retry(d: MailDelivery) {
  try {
    await mailDeliveriesRetry({ client: api, path: { id: d.id } });
    notify.success('Envío en cola de nuevo');
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}

const columns: ColumnDef<MailDelivery>[] = [
  { id: 'createdAt', header: 'Fecha', cell: ({ row }) => h(RelativeTime, { value: row.original.sentAt ?? row.original.createdAt }) },
  { id: 'to', header: 'Destinatario', cell: ({ row }) => h('span', { class: 'font-medium break-all', 'data-testid': 'delivery-to' }, row.original.to) },
  {
    id: 'what',
    header: 'Correo',
    cell: ({ row }) =>
      h('div', { class: 'flex flex-col' }, [
        h('span', DELIVERY_CATEGORIES[row.original.category] ?? row.original.category),
        row.original.automation ? h('span', { class: 'text-muted-foreground text-xs' }, row.original.automation.name) : row.original.templateKey ? h('code', { class: 'text-muted-foreground text-xs' }, row.original.templateKey) : null,
      ]),
  },
  { id: 'status', header: 'Estado', cell: ({ row }) => h(StatusBadge, { status: row.original.status, 'data-testid': 'delivery-status' }) },
  {
    id: 'detail',
    header: 'Detalle',
    cell: ({ row }) =>
      h('span', { class: 'text-muted-foreground line-clamp-2 max-w-sm text-xs' }, row.original.error ?? [row.original.transport && (MAIL_PROVIDERS[row.original.transport]?.name ?? row.original.transport), row.original.messageId].filter(Boolean).join(' · ')),
  },
  {
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, 'Acciones'),
    cell: ({ row }) =>
      row.original.status === 'failed' && row.original.automation && can('mail.manage')
        ? h(ActionMenu, { label: `Acciones para el envío a ${row.original.to}`, items: [{ label: 'Reintentar', icon: 'refresh', onSelect: () => retry(row.original) }] })
        : null,
  },
];
</script>

<template>
  <PageHeader title="Envíos de correo" description="Todo lo que la plataforma envió (códigos, invitaciones, alertas, pruebas y automatizaciones) con la respuesta del proveedor. Los asuntos no se guardan: pueden contener códigos. Se conservan 90 días." />

  <DataToolbar v-model:search="list.search.value" placeholder="Buscar por destinatario" :filtered="list.filtered.value" testid="delivery" @clear="list.reset()">
    <template #filters>
      <Select v-model="statusFilter">
        <SelectTrigger class="sm:w-44" aria-label="Filtrar por estado"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los estados</SelectItem>
          <SelectItem value="sent">Enviados</SelectItem>
          <SelectItem value="queued">En cola</SelectItem>
          <SelectItem value="failed">Fallidos</SelectItem>
          <SelectItem value="skipped">Omitidos</SelectItem>
        </SelectContent>
      </Select>
    </template>
  </DataToolbar>

  <LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" testid="deliveries-load-error" @retry="refresh()" />
  <EmptyState v-else-if="data && data.total === 0 && !list.filtered.value" title="Aún no hay envíos" description="Aparecerán aquí los códigos de acceso, invitaciones, pruebas y automatizaciones." :icon="Send" />
  <DataTable
    v-else
    :columns="columns"
    :data="data?.items ?? []"
    :total="data?.total ?? 0"
    :page="list.query.page"
    :page-size="list.query.pageSize"
    :loading="status === 'pending'"
    caption="Envíos de correo"
    @update:page="list.query.page = $event"
  />
</template>
