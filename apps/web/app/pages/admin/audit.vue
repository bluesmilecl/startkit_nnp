<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { adminAuditList, type AuditEvent } from '@starter/api-client';
import { Download } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '#ui/components/ui/sheet';
import { formatDate } from '#ui/lib/format';
import StatusBadge from '~/components/shared/StatusBadge.vue';

definePageMeta({ permission: 'audit.read' });
useHead({ title: 'Auditoría' });
const api = useApi();
const q = reactive({ page: 1, pageSize: 25, action: '', resourceType: '', outcome: 'all' });
const { data, status } = await useAsyncData(
  'audit',
  () =>
    unwrap(
      adminAuditList({
        client: api,
        query: {
          page: q.page,
          pageSize: q.pageSize,
          action: q.action || undefined,
          resourceType: q.resourceType || undefined,
          outcome: q.outcome === 'all' ? undefined : (q.outcome as AuditEvent['outcome']),
        },
      }),
    ),
  { watch: [q] },
);
const selected = ref<AuditEvent | null>(null);
const columns: ColumnDef<AuditEvent>[] = [
  { id: 'occurredAt', header: 'Fecha', cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, formatDate(row.original.occurredAt)) },
  { id: 'action', header: 'Acción', cell: ({ row }) => h('button', { class: 'font-mono text-xs hover:underline', onClick: () => (selected.value = row.original) }, row.original.action) },
  { id: 'resource', header: 'Recurso', cell: ({ row }) => h('span', { class: 'text-xs' }, `${row.original.resourceType}${row.original.resourceId ? ` · ${row.original.resourceId.slice(0, 8)}` : ''}`) },
  { id: 'actor', header: 'Actor', cell: ({ row }) => `${row.original.actorEmail ?? '—'}${row.original.actorType === 'agent' ? ' (vía agente)' : row.original.actorType !== 'user' ? ` (${row.original.actorType})` : ''}` },
  { id: 'outcome', header: 'Resultado', cell: ({ row }) => h(StatusBadge, { status: row.original.outcome }) },
];
const exportUrl = computed(() => {
  const params = new URLSearchParams();
  if (q.action) params.set('action', q.action);
  if (q.resourceType) params.set('resourceType', q.resourceType);
  if (q.outcome !== 'all') params.set('outcome', q.outcome);
  return `/api/admin/audit/export.csv?${params}`;
});
</script>

<template>
  <PageHeader title="Auditoría" description="Registro inmutable de cambios, accesos denegados y acciones ejecutadas por agentes.">
    <template #actions><Button variant="outline" as-child><a :href="exportUrl" download><Download class="size-4" /> Exportar CSV</a></Button></template>
  </PageHeader>
  <div class="grid gap-2 sm:grid-cols-3">
    <Input v-model.lazy="q.action" placeholder="Acción (ej. users.)" aria-label="Filtrar por acción" @change="q.page = 1" />
    <Input v-model.lazy="q.resourceType" placeholder="Tipo de recurso (ej. user)" aria-label="Filtrar por recurso" @change="q.page = 1" />
    <Select v-model="q.outcome" @update:model-value="q.page = 1">
      <SelectTrigger aria-label="Filtrar por resultado"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos los resultados</SelectItem>
        <SelectItem value="success">Éxito</SelectItem>
        <SelectItem value="denied">Denegado</SelectItem>
        <SelectItem value="failed">Fallido</SelectItem>
        <SelectItem value="cancelled">Cancelado</SelectItem>
      </SelectContent>
    </Select>
  </div>
  <DataTable :columns="columns" :data="data?.items ?? []" :total="data?.total ?? 0" :page="q.page" :page-size="q.pageSize" :loading="status === 'pending'" caption="Eventos de auditoría" @update:page="q.page = $event" />
  <Sheet :open="!!selected" @update:open="(v) => !v && (selected = null)">
    <SheetContent class="overflow-y-auto sm:max-w-xl">
      <SheetHeader v-if="selected">
        <SheetTitle class="font-mono">{{ selected.action }}</SheetTitle>
        <SheetDescription>{{ formatDate(selected.occurredAt) }} · {{ selected.actorEmail ?? selected.actorType }} · solicitud {{ selected.requestId ?? '—' }}</SheetDescription>
      </SheetHeader>
      <div v-if="selected" class="space-y-4 p-4">
        <JsonDiff :before="selected.before" :after="selected.after" />
        <div v-if="selected.metadata"><p class="mb-1 text-sm font-medium">Metadatos</p><pre class="bg-muted overflow-x-auto rounded p-2 text-xs">{{ JSON.stringify(selected.metadata, null, 2) }}</pre></div>
        <p v-if="selected.agentId" class="text-muted-foreground text-xs">Ejecutado por el agente {{ selected.agentId }} en la conversación {{ selected.conversationId }}.</p>
      </div>
    </SheetContent>
  </Sheet>
</template>
