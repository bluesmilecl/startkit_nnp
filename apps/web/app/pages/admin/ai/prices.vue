<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { aiConnectionsList, aiPricesList, aiPricesSet, aiPricesSync, aiSyncRuns, type PriceRow } from '@starter/api-client';
import { CreatePriceInput } from '@starter/contracts';
import { Plus, RefreshCw } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Switch } from '#ui/components/ui/switch';
import { Label } from '#ui/components/ui/label';
import { Badge } from '#ui/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card';
import { formatDate, formatPerMillion } from '#ui/lib/format';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';

definePageMeta({ permission: 'ai.models.manage', feature: 'ai' });
useHead({ title: 'Tarifas' });
const api = useApi();
const notify = useNotify();
const query = reactive({ page: 1, pageSize: 50, provider: '', modelId: '', includeHistory: false });
const modelInput = ref('');
let debounce: ReturnType<typeof setTimeout> | undefined;
watch(modelInput, (v) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    query.modelId = v.trim();
    query.page = 1;
  }, 300);
});
const { data, status, refresh } = await useAsyncData(
  'ai-prices',
  () => unwrap(aiPricesList({ client: api, query: { page: query.page, pageSize: query.pageSize, provider: query.provider || undefined, modelId: query.modelId || undefined, includeHistory: query.includeHistory } })),
  { watch: [query] },
);
const { data: runs, refresh: refreshRuns } = await useAsyncData('ai-price-runs', () => unwrap(aiSyncRuns({ client: api, query: { kind: 'prices' } })));
const { data: connections } = await useAsyncData('ai-connections-min', () => unwrap(aiConnectionsList({ client: api })));
const providerFilter = computed({
  get: () => query.provider || 'all',
  set: (v: string) => {
    query.provider = v === 'all' ? '' : v;
    query.page = 1;
  },
});
const SCOPE: Record<string, string> = { direct: 'Directa', gateway: 'Gateway', custom: 'Personalizada', tier: 'Nivel de servicio' };

const columns: ColumnDef<PriceRow>[] = [
  { id: 'model', header: 'Modelo', cell: ({ row }) => h('div', [h('div', { class: 'font-medium' }, row.original.modelId), h('div', { class: 'text-muted-foreground text-xs' }, row.original.provider)]) },
  { id: 'unit', header: 'Unidad', cell: ({ row }) => UNIT_LABELS[row.original.unit] ?? row.original.unit },
  { id: 'price', header: 'Precio', cell: ({ row }) => h('span', { class: 'tabular-nums' }, formatPerMillion(row.original.price, row.original.unitQuantity)) },
  {
    id: 'scope',
    header: 'Ámbito',
    cell: ({ row }) =>
      row.original.connectionId
        ? h(Badge, { variant: 'secondary' }, () => `Acuerdo: ${connections.value?.find((c) => c.id === row.original.connectionId)?.alias ?? 'conexión'}`)
        : (SCOPE[row.original.billingScope] ?? row.original.billingScope),
  },
  {
    id: 'source',
    header: 'Fuente',
    cell: ({ row }) => (row.original.source.url ? h('a', { href: row.original.source.url, target: '_blank', rel: 'noopener noreferrer', class: 'underline-offset-4 hover:underline' }, row.original.source.name) : row.original.source.name),
  },
  { id: 'fetched', header: 'Obtenida', cell: ({ row }) => h(RelativeTime, { value: row.original.fetchedAt }) },
  {
    id: 'validity',
    header: 'Vigencia',
    cell: ({ row }) => h('span', { class: 'text-xs' }, `${formatDate(row.original.effectiveFrom, { dateStyle: 'short' })} → ${row.original.effectiveTo ? formatDate(row.original.effectiveTo, { dateStyle: 'short' }) : 'vigente'}`),
  },
];

async function sync() {
  try {
    await aiPricesSync({ client: api });
    toast.success('Sincronización de tarifas en cola');
    setTimeout(async () => {
      await refreshRuns();
      await refresh();
    }, 4000);
  } catch (err) {
    notify.error(err);
  }
}

const open = ref(false);
const form = useZodForm(CreatePriceInput, { provider: '', modelId: '', connectionId: null, billingScope: 'custom', unit: 'input_tokens', unitQuantity: 1_000_000, price: '', sourceName: 'Manual', sourceUrl: null });
const connectionModel = computed({
  get: () => form.values.connectionId ?? 'none',
  set: (v: string) => {
    form.values.connectionId = v === 'none' ? null : v;
    const c = connections.value?.find((x) => x.id === v);
    if (c) form.values.provider = c.provider;
  },
});
const sourceUrl = nullableModel(form.values, 'sourceUrl');
const submit = form.handleSubmit(async (values) => {
  const r = await unwrap(aiPricesSet({ client: api, body: values }));
  toast.success(r.result === 'unchanged' ? 'La tarifa ya estaba vigente' : 'Tarifa registrada', { description: r.result === 'updated' ? 'La versión anterior quedó cerrada; los costos históricos no cambian.' : undefined });
  open.value = false;
  form.reset();
  await refresh();
});
</script>

<template>
  <PageHeader title="Tarifas" description="Precios versionados por unidad (USD). Se sincronizan desde el catálogo estructurado; los acuerdos por conexión tienen prioridad.">
    <template #actions>
      <Button variant="outline" data-testid="prices-sync" @click="sync"><RefreshCw class="size-4" /> Sincronizar</Button>
      <Button data-testid="price-new" @click="open = true"><Plus class="size-4" /> Registrar tarifa</Button>
    </template>
  </PageHeader>

  <div class="flex flex-wrap items-center gap-2">
    <Select v-model="providerFilter">
      <SelectTrigger class="w-44" aria-label="Proveedor"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos los proveedores</SelectItem>
        <SelectItem v-for="p in ['openai', 'anthropic', 'google', 'openai-compatible', 'test']" :key="p" :value="p">{{ p }}</SelectItem>
      </SelectContent>
    </Select>
    <Input v-model="modelInput" class="w-full sm:w-64" placeholder="ID exacto del modelo" aria-label="Modelo" />
    <div class="flex items-center gap-2"><Switch id="hist" v-model="query.includeHistory" /><Label for="hist">Incluir historial</Label></div>
  </div>

  <DataTable :columns="columns" :data="data?.items ?? []" :total="data?.total ?? 0" :page="query.page" :page-size="query.pageSize" :loading="status === 'pending'" empty-text="Sin tarifas registradas" @update:page="query.page = $event" />

  <Card v-if="runs?.length">
    <CardHeader><CardTitle class="text-base">Sincronizaciones recientes</CardTitle></CardHeader>
    <CardContent>
      <ul class="divide-y text-sm">
        <li v-for="r in runs.slice(0, 5)" :key="r.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
          <span class="flex items-center gap-2"><StatusBadge :status="r.status" /> <RelativeTime :value="r.startedAt" /></span>
          <span class="text-muted-foreground text-xs">
            <template v-if="r.stats">{{ r.stats.created ?? 0 }} nuevas · {{ r.stats.updated ?? 0 }} cambiadas · {{ r.stats.unchanged ?? 0 }} sin cambios · {{ r.stats.skipped ?? 0 }} sin dato</template>
            <span v-if="r.error" class="text-destructive"> · {{ r.error }}</span>
          </span>
        </li>
      </ul>
    </CardContent>
  </Card>

  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader><DialogTitle>Registrar tarifa</DialogTitle><DialogDescription>Crea una nueva versión vigente; la anterior se cierra sin alterar costos ya calculados.</DialogDescription></DialogHeader>
      <form id="price-form" class="space-y-4" novalidate @submit="submit">
        <Field>
          <FieldLabel for="pr-conn">Ámbito</FieldLabel>
          <Select v-model="connectionModel">
            <SelectTrigger id="pr-conn"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">Todas las conexiones del proveedor</SelectItem><SelectItem v-for="c in connections" :key="c.id" :value="c.id">Acuerdo de {{ c.alias }}</SelectItem></SelectContent>
          </Select>
          <FieldDescription>Un acuerdo por conexión (descuento, gateway) prevalece sobre la tarifa pública.</FieldDescription>
        </Field>
        <div class="grid grid-cols-2 gap-3">
          <Field :data-invalid="!!form.errors.provider"><FieldLabel for="pr-prov">Proveedor</FieldLabel><Input id="pr-prov" v-model="form.values.provider" :disabled="!!form.values.connectionId" /><FieldError :errors="[form.errors.provider]" /></Field>
          <Field :data-invalid="!!form.errors.modelId"><FieldLabel for="pr-model">Modelo</FieldLabel><Input id="pr-model" v-model="form.values.modelId" /><FieldError :errors="[form.errors.modelId]" /></Field>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel for="pr-unit">Unidad</FieldLabel>
            <Select v-model="form.values.unit">
              <SelectTrigger id="pr-unit"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem v-for="(l, k) in UNIT_LABELS" :key="k" :value="k">{{ l }}</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel for="pr-q">Por cantidad</FieldLabel><Input id="pr-q" v-model.number="form.values.unitQuantity" type="number" min="1" /></Field>
        </div>
        <Field :data-invalid="!!form.errors.price"><FieldLabel for="pr-price">Precio (USD)</FieldLabel><Input id="pr-price" v-model="form.values.price" inputmode="decimal" placeholder="0.15" /><FieldError :errors="[form.errors.price]" /></Field>
        <div class="grid grid-cols-2 gap-3">
          <Field><FieldLabel for="pr-src">Fuente</FieldLabel><Input id="pr-src" v-model="form.values.sourceName" /></Field>
          <Field :data-invalid="!!form.errors.sourceUrl"><FieldLabel for="pr-url">URL</FieldLabel><Input id="pr-url" v-model="sourceUrl" type="url" /><FieldError :errors="[form.errors.sourceUrl]" /></Field>
        </div>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="price-form" :disabled="form.submitting.value">Guardar</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
