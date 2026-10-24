<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { aiFxRefresh, aiUsageRequests, aiUsageSummary, type AiRequestRow } from '@starter/api-client';
import { Activity, CircleDollarSign, Download, HelpCircle, Timer, TriangleAlert } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Badge } from '#ui/components/ui/badge';
import { Switch } from '#ui/components/ui/switch';
import { Label } from '#ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { formatClp, formatDate, formatNumber, formatUsd } from '#ui/lib/format';
import StatusBadge from '~/components/shared/StatusBadge.vue';

definePageMeta({ permission: 'ai.usage.read', feature: 'ai' });
useHead({ title: 'Uso y costos' });
const api = useApi();
const can = useCan();

type GroupBy = 'provider' | 'model' | 'agent' | 'user' | 'feature' | 'organization';
const filters = reactive({ days: '30', groupBy: 'model' as GroupBy, feature: 'all' });
const range = computed(() => {
  const to = new Date();
  const from = new Date(to.getTime() - Number(filters.days) * 86_400_000);
  from.setUTCHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
});
const { data: summary, refresh } = await useAsyncData(
  'ai-usage-summary',
  () => unwrap(aiUsageSummary({ client: api, query: { ...range.value, groupBy: filters.groupBy, feature: filters.feature === 'all' ? undefined : filters.feature } })),
  { watch: [() => filters.days, () => filters.groupBy, () => filters.feature] },
);

// Visual CLP conversion: requires a stored dated rate (FX_PROVIDER=mindicador).
const showClp = ref(false);
const money = (usd: string | null | undefined) => (showClp.value && summary.value?.fx ? formatClp(usd, summary.value.fx.rate) : formatUsd(usd));
const moneyNum = (v: number) => money(String(v));
async function refreshFx() {
  try {
    await aiFxRefresh({ client: api });
    toast.success('Actualización de tasa en cola', { description: 'Requiere FX_PROVIDER=mindicador en la configuración del servidor.' });
    setTimeout(refresh, 4000);
  } catch (err) {
    toast.error(apiError(err).message);
  }
}

const t = computed(() => summary.value?.totals);
const daily = computed(() => (summary.value?.daily ?? []).map((d) => ({ x: d.date, cost: Number(d.costUsd), cumulative: Number(d.cumulativeUsd), requests: d.requests, errors: d.errors, input: d.inputTokens, output: d.outputTokens })));
const donut = computed(() => (summary.value?.breakdown ?? []).filter((b) => Number(b.costUsd) > 0).slice(0, 8).map((b) => ({ key: b.key, label: groupLabel(b.label), value: Number(b.costUsd) })));
function groupLabel(label: string) {
  return filters.groupBy === 'feature' ? (FEATURE_LABELS[label] ?? label) : label;
}

// ── ledger ──────────────────────────────────────────────────────────────
const ledgerQuery = reactive({ page: 1, pageSize: 20, status: 'all', costStatus: 'all' });
const { data: requests, status: reqStatus } = await useAsyncData(
  'ai-usage-requests',
  () =>
    unwrap(
      aiUsageRequests({
        client: api,
        query: {
          page: ledgerQuery.page,
          pageSize: ledgerQuery.pageSize,
          feature: filters.feature === 'all' ? undefined : filters.feature,
          status: ledgerQuery.status === 'all' ? undefined : ledgerQuery.status,
          costStatus: ledgerQuery.costStatus === 'all' ? undefined : ledgerQuery.costStatus,
        },
      }),
    ),
  { watch: [ledgerQuery, () => filters.feature] },
);
const exportHref = computed(() => {
  const p = new URLSearchParams();
  if (filters.feature !== 'all') p.set('feature', filters.feature);
  if (ledgerQuery.status !== 'all') p.set('status', ledgerQuery.status);
  if (ledgerQuery.costStatus !== 'all') p.set('costStatus', ledgerQuery.costStatus);
  return `/api/ai/usage/export.csv${p.size ? `?${p}` : ''}`;
});
const columns: ColumnDef<AiRequestRow>[] = [
  { id: 'at', header: 'Fecha', cell: ({ row }) => h('span', { class: 'text-xs whitespace-nowrap' }, formatDate(row.original.startedAt)) },
  { id: 'feature', header: 'Función', cell: ({ row }) => FEATURE_LABELS[row.original.feature] ?? row.original.feature },
  { id: 'model', header: 'Modelo', cell: ({ row }) => h('span', { class: 'text-xs' }, row.original.modelId ? `${row.original.provider}:${row.original.modelId}` : '—') },
  { id: 'user', header: 'Usuario', cell: ({ row }) => h('span', { class: 'text-xs' }, row.original.userEmail ?? 'sistema') },
  { id: 'status', header: 'Estado', cell: ({ row }) => h(StatusBadge, { status: row.original.status }) },
  { id: 'attempts', header: 'Intentos', cell: ({ row }) => h('span', { class: 'tabular-nums' }, row.original.attempts) },
  { id: 'tokens', header: 'Tokens (↑/↓)', cell: ({ row }) => h('span', { class: 'tabular-nums text-xs' }, `${formatNumber(row.original.inputTokens)} / ${formatNumber(row.original.outputTokens)}`) },
  {
    id: 'cost',
    header: 'Costo',
    cell: ({ row }) =>
      h('div', { class: 'flex items-center gap-1 tabular-nums' }, [
        row.original.costStatus === 'unknown' ? h(Badge, { variant: 'outline' }, () => 'desconocido') : money(row.original.costUsd),
        row.original.costStatus === 'estimated' ? h(Badge, { variant: 'secondary' }, () => 'est.') : null,
      ]),
  },
  { id: 'latency', header: 'Latencia', cell: ({ row }) => h('span', { class: 'tabular-nums text-xs' }, row.original.latencyMs !== null ? `${formatNumber(row.original.latencyMs)} ms` : '—') },
];
</script>

<template>
  <PageHeader title="Uso y costos" description="Datos del libro de consumo. USD es la moneda base; el costo desconocido nunca se cuenta como cero.">
    <template #actions>
      <Select v-model="filters.days">
        <SelectTrigger class="w-36" aria-label="Período"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="1">Últimas 24 h</SelectItem><SelectItem value="7">7 días</SelectItem><SelectItem value="30">30 días</SelectItem><SelectItem value="90">90 días</SelectItem></SelectContent>
      </Select>
      <Select v-model="filters.feature">
        <SelectTrigger class="w-48" aria-label="Función"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">Todas las funciones</SelectItem><SelectItem v-for="(l, k) in FEATURE_LABELS" :key="k" :value="k">{{ l }}</SelectItem></SelectContent>
      </Select>
    </template>
  </PageHeader>

  <div class="flex flex-wrap items-center gap-3 text-sm">
    <template v-if="summary?.fx">
      <div class="flex items-center gap-2"><Switch id="clp" v-model="showClp" data-testid="clp-toggle" /><Label for="clp">Ver en CLP</Label></div>
      <span class="text-muted-foreground text-xs">Conversión visual: 1 USD = {{ Number(summary.fx.rate).toLocaleString('es-CL') }} CLP · {{ summary.fx.rateDate }} · {{ summary.fx.source }}</span>
    </template>
    <span v-else class="text-muted-foreground text-xs">Conversión a CLP no configurada (FX_PROVIDER).</span>
    <Button v-if="can('ai.models.manage')" variant="ghost" size="sm" @click="refreshFx">Actualizar tasa</Button>
  </div>

  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <StatCard title="Costo del período" :value="money(t?.costUsd)" :hint="`Calculado ${money(t?.calculatedUsd)} · estimado ${money(t?.estimatedUsd)}`" :icon="CircleDollarSign" data-testid="stat-cost" />
    <StatCard title="Sin tarifa conocida" :value="formatNumber(t?.unknownCostRequests)" hint="Solicitudes con costo desconocido (no sumadas)" :icon="HelpCircle" data-testid="stat-unknown" />
    <StatCard title="Solicitudes" :value="formatNumber(t?.requests)" :hint="`${formatNumber(t?.errors)} con error · ${formatNumber(t?.inputTokens)} ↑ / ${formatNumber(t?.outputTokens)} ↓ tokens`" :icon="Activity" />
    <StatCard title="Latencia p50 / p95" :value="t?.p50LatencyMs != null ? `${Math.round(t.p50LatencyMs)} / ${Math.round(t.p95LatencyMs ?? 0)} ms` : '—'" :icon="Timer" />
  </div>
  <p v-if="t && Number(t.reconciledUsd) > 0" class="text-muted-foreground text-xs">Conciliado con el proveedor: {{ money(t.reconciledUsd) }}</p>

  <Tabs default-value="cost">
    <TabsList>
      <TabsTrigger value="cost">Costo</TabsTrigger>
      <TabsTrigger value="requests">Solicitudes</TabsTrigger>
      <TabsTrigger value="tokens">Tokens</TabsTrigger>
    </TabsList>
    <Card class="mt-2">
      <CardContent class="pt-6">
        <TabsContent value="cost" class="grid gap-6 lg:grid-cols-2">
          <TimeSeriesChart title="Costo diario" kind="bar" :data="daily" :series="[{ key: 'cost', label: 'Costo (USD)' }]" :value-format="moneyNum" csv-name="costo-diario.csv" />
          <TimeSeriesChart title="Costo acumulado" kind="area" :data="daily" :series="[{ key: 'cumulative', label: 'Acumulado (USD)' }]" :value-format="moneyNum" csv-name="costo-acumulado.csv" />
        </TabsContent>
        <TabsContent value="requests">
          <TimeSeriesChart title="Solicitudes y errores por día" kind="line" :data="daily" :series="[{ key: 'requests', label: 'Solicitudes' }, { key: 'errors', label: 'Errores' }]" csv-name="solicitudes.csv" />
        </TabsContent>
        <TabsContent value="tokens">
          <TimeSeriesChart title="Tokens por día" kind="stacked" :data="daily" :series="[{ key: 'input', label: 'Entrada' }, { key: 'output', label: 'Salida' }]" csv-name="tokens.csv" />
        </TabsContent>
      </CardContent>
    </Card>
  </Tabs>

  <div class="grid gap-4 lg:grid-cols-3">
    <Card>
      <CardHeader><CardTitle class="text-base">Distribución del costo</CardTitle></CardHeader>
      <CardContent><DonutChart title="Por grupo" :data="donut" :value-format="moneyNum" csv-name="distribucion.csv" /></CardContent>
    </Card>
    <Card class="lg:col-span-2">
      <CardHeader class="flex flex-row items-center justify-between gap-2">
        <div><CardTitle class="text-base">Desglose</CardTitle><CardDescription>Ordenado por costo.</CardDescription></div>
        <Select v-model="filters.groupBy">
          <SelectTrigger class="w-40" aria-label="Agrupar por"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="model">Modelo</SelectItem><SelectItem value="provider">Proveedor</SelectItem><SelectItem value="feature">Función</SelectItem><SelectItem value="agent">Agente</SelectItem><SelectItem value="user">Usuario</SelectItem>
            <SelectItem v-if="can('organizations.read')" value="organization">Organización</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent class="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Grupo</TableHead><TableHead class="text-right">Solicitudes</TableHead><TableHead class="text-right">Costo</TableHead><TableHead class="text-right">Sin tarifa</TableHead><TableHead class="text-right">Errores</TableHead><TableHead class="text-right">Latencia media</TableHead></TableRow></TableHeader>
          <TableBody>
            <TableRow v-for="b in summary?.breakdown" :key="b.key">
              <TableCell class="max-w-64 truncate">{{ groupLabel(b.label) }}</TableCell>
              <TableCell class="text-right tabular-nums">{{ formatNumber(b.requests) }}</TableCell>
              <TableCell class="text-right tabular-nums">{{ money(b.costUsd) }}</TableCell>
              <TableCell class="text-right tabular-nums"><span v-if="b.unknownCostRequests" class="inline-flex items-center gap-1"><TriangleAlert class="size-3" aria-hidden="true" />{{ b.unknownCostRequests }}</span><span v-else>0</span></TableCell>
              <TableCell class="text-right tabular-nums">{{ b.errors }}</TableCell>
              <TableCell class="text-right tabular-nums">{{ b.avgLatencyMs !== null ? `${formatNumber(b.avgLatencyMs)} ms` : '—' }}</TableCell>
            </TableRow>
            <TableRow v-if="!summary?.breakdown.length"><TableCell colspan="6" class="text-muted-foreground text-center">Sin consumo en el período</TableCell></TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>

  <Card>
    <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-2">
      <div><CardTitle class="text-base">Libro de consumo</CardTitle><CardDescription>Una fila por solicitud lógica; los reintentos y fallbacks se cuentan como intentos.</CardDescription></div>
      <div class="flex flex-wrap gap-2">
        <Select v-model="ledgerQuery.status">
          <SelectTrigger class="w-36" aria-label="Estado"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todo estado</SelectItem><SelectItem value="succeeded">Completado</SelectItem><SelectItem value="failed">Fallido</SelectItem><SelectItem value="cancelled">Cancelado</SelectItem></SelectContent>
        </Select>
        <Select v-model="ledgerQuery.costStatus">
          <SelectTrigger class="w-40" aria-label="Estado del costo"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todo costo</SelectItem><SelectItem v-for="(l, k) in COST_STATUS_LABELS" :key="k" :value="k">{{ l }}</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" as="a" :href="exportHref" download><Download class="size-4" /> CSV</Button>
      </div>
    </CardHeader>
    <CardContent>
      <DataTable :columns="columns" :data="requests?.items ?? []" :total="requests?.total ?? 0" :page="ledgerQuery.page" :page-size="ledgerQuery.pageSize" :loading="reqStatus === 'pending'" empty-text="Sin solicitudes" @update:page="ledgerQuery.page = $event" />
    </CardContent>
  </Card>
</template>
