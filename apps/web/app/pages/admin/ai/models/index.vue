<script setup lang="ts">
import { h } from 'vue';
import type { ColumnDef } from '@tanstack/vue-table';
import { aiConnectionsList, aiModelsImport, aiModelsList, aiModelsUpdate, aiModelsVerify, aiSyncRuns, type CatalogModel } from '@starter/api-client';
import { ManualModelInput } from '@starter/contracts';
import { Cpu, Plus, Search } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Switch } from '#ui/components/ui/switch';
import { Badge } from '#ui/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Label } from '#ui/components/ui/label';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card';
import { formatNumber, formatPerMillion } from '#ui/lib/format';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';
import CapabilityBadges from '~/components/shared/CapabilityBadges.vue';

definePageMeta({ permission: 'ai.models.manage', feature: 'ai' });
useHead({ title: 'Modelos' });

const api = useApi();
const route = useRoute();
const router = useRouter();
type Fn = 'chat' | 'embedding' | 'transcription' | 'speech' | 'image' | 'moderation' | 'other';
type Availability = 'available' | 'unverified' | 'unavailable' | 'deprecated';
const query = reactive({
  page: Number(route.query.page ?? 1),
  pageSize: 25,
  search: String(route.query.search ?? ''),
  function: (route.query.function as Fn | undefined) ?? undefined,
  availability: (route.query.availability as Availability | undefined) ?? undefined,
  connectionId: (route.query.connectionId as string | undefined) ?? undefined,
  capability: (route.query.capability as string | undefined) ?? undefined,
  sort: 'name' as 'name' | 'inputPrice' | 'context',
});
const searchInput = ref(query.search);
let debounce: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, (v) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    query.search = v;
    query.page = 1;
  }, 300);
});
watch(
  () => ({ ...query }),
  (q) => router.replace({ query: { page: q.page > 1 ? q.page : undefined, search: q.search || undefined, function: q.function, availability: q.availability, connectionId: q.connectionId, capability: q.capability } }),
);
const { data, status, refresh } = await useAsyncData('ai-models', () => unwrap(aiModelsList({ client: api, query: { ...query, search: query.search || undefined } })), { watch: [query] });
const { data: connections } = await useAsyncData('ai-connections-min', () => unwrap(aiConnectionsList({ client: api })));
const { data: runs, refresh: refreshRuns } = await useAsyncData('ai-model-runs', () => unwrap(aiSyncRuns({ client: api, query: { kind: 'models' } })));

/** Select bound to an optional filter ('all' = no filter). */
function filterModel<K extends 'function' | 'availability' | 'connectionId' | 'capability'>(key: K) {
  return computed({
    get: () => (query[key] as string | undefined) ?? 'all',
    set: (v: string) => {
      (query as Record<string, unknown>)[key] = v === 'all' ? undefined : v;
      query.page = 1;
    },
  });
}
const fnFilter = filterModel('function');
const availabilityFilter = filterModel('availability');
const connectionFilter = filterModel('connectionId');
const capabilityFilter = filterModel('capability');

const verifying = ref<string | null>(null);
async function verify(m: CatalogModel) {
  verifying.value = m.id;
  try {
    const r = await unwrap(aiModelsVerify({ client: api, path: { id: m.id } }));
    if (r.availability === 'available') toast.success(`${m.modelId} disponible`, { description: `${r.message} · ${r.latencyMs} ms` });
    else toast.error(`${m.modelId}: ${r.message}`);
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  } finally {
    verifying.value = null;
  }
}
async function setEnabled(m: CatalogModel, enabled: boolean) {
  try {
    await aiModelsUpdate({ client: api, path: { id: m.id }, body: { enabled } });
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}

function priceOf(m: CatalogModel, unit: string) {
  const p = m.prices.find((x) => x.unit === unit);
  return p ? formatPerMillion(p.price, p.unitQuantity) : null;
}

const columns: ColumnDef<CatalogModel>[] = [
  {
    id: 'model',
    header: 'Modelo',
    cell: ({ row }) =>
      h('div', { class: 'min-w-48' }, [
        h(resolveComponent('NuxtLink'), { to: `/admin/ai/models/${row.original.id}`, class: 'font-medium underline-offset-4 hover:underline', 'data-testid': 'model-link' }, () => row.original.displayName ?? row.original.modelId),
        h('div', { class: 'text-muted-foreground text-xs' }, `${row.original.connectionAlias} · ${row.original.modelId}`),
      ]),
  },
  { id: 'functions', header: 'Función', cell: ({ row }) => h('div', { class: 'flex flex-wrap gap-1' }, row.original.functions.map((f) => h(Badge, { variant: 'secondary' }, () => FUNCTION_LABELS[f] ?? f))) },
  {
    id: 'context',
    header: 'Contexto',
    cell: ({ row }) => h('span', { class: 'tabular-nums' }, row.original.embeddingDimensions ? `${row.original.embeddingDimensions} dim` : formatNumber(row.original.contextWindow)),
  },
  { id: 'capabilities', header: 'Capacidades', cell: ({ row }) => h(CapabilityBadges, { capabilities: row.original.capabilities, compact: true, only: ['tools', 'structured_output', 'attachments_image', 'streaming'] }) },
  {
    id: 'price',
    header: 'Tarifa',
    cell: ({ row }) => {
      const m = row.original;
      const unit = m.functions.includes('embedding') ? 'embedding_tokens' : m.functions.includes('transcription') ? 'audio_seconds' : 'input_tokens';
      const input = priceOf(m, unit);
      const output = priceOf(m, 'output_tokens');
      if (!input && !output) return h(Badge, { variant: 'outline', 'data-testid': 'price-unknown' }, () => 'Tarifa desconocida');
      return h('div', { class: 'text-xs tabular-nums' }, [input && h('div', `↑ ${input}`), output && h('div', `↓ ${output}`)]);
    },
  },
  { id: 'availability', header: 'Disponibilidad', cell: ({ row }) => h(StatusBadge, { status: row.original.availability, 'data-testid': 'model-availability' }) },
  { id: 'enabled', header: 'Habilitado', cell: ({ row }) => h(Switch, { modelValue: row.original.enabled, 'onUpdate:modelValue': (v: boolean) => setEnabled(row.original, v), 'aria-label': `Habilitar ${row.original.modelId}` }) },
  {
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, 'Acciones'),
    cell: ({ row }) => h(Button, { variant: 'outline', size: 'sm', disabled: verifying.value === row.original.id, onClick: () => verify(row.original), 'data-testid': 'model-verify' }, () => 'Verificar'),
  },
];

// ── manual import ───────────────────────────────────────────────────────
const importOpen = ref(false);
const form = useZodForm(ManualModelInput, { connectionId: '', modelId: '', functions: ['chat'], inputModalities: ['text'], outputModalities: ['text'], capabilities: {}, sourceUrl: '' });
const importFunctions = ['chat', 'embedding', 'transcription'] as const;
function toggleFunction(f: (typeof importFunctions)[number], on: boolean) {
  const set = new Set(form.values.functions);
  if (on) set.add(f);
  else set.delete(f);
  form.values.functions = [...set];
}
const capabilityState = (k: string) => (form.values.capabilities as Record<string, string>)?.[k] ?? 'unknown';
function setCapability(k: string, v: string) {
  form.values.capabilities = { ...(form.values.capabilities ?? {}), [k]: v as 'yes' | 'no' | 'unknown' };
}
const submitImport = form.handleSubmit(async (values) => {
  const m = await unwrap(aiModelsImport({ client: api, body: values }));
  toast.success(`${m.modelId} importado`, { description: 'Verifícalo para marcarlo como disponible.' });
  importOpen.value = false;
  form.reset();
  await refresh();
});

const lastRun = computed(() => runs.value?.[0]);
onMounted(() => {
  // Sync runs are executed by the worker; refresh while one is running.
  const t = setInterval(async () => {
    if (lastRun.value?.status === 'running' || route.query.syncing) {
      await refreshRuns();
      await refresh();
    }
  }, 4000);
  onBeforeUnmount(() => clearInterval(t));
});
</script>

<template>
  <PageHeader title="Modelos" description="Catálogo por conexión. «Disponible» exige una verificación real con tu credencial; las capacidades sin evidencia figuran como desconocidas.">
    <template #actions><Button variant="outline" @click="importOpen = true"><Plus class="size-4" /> Importar manualmente</Button></template>
  </PageHeader>

  <div class="flex flex-wrap items-end gap-2">
    <div class="relative w-full sm:w-64">
      <Search class="text-muted-foreground absolute top-2.5 left-2.5 size-4" aria-hidden="true" />
      <Input v-model="searchInput" placeholder="Buscar modelo…" class="pl-8" aria-label="Buscar modelo" data-testid="models-search" />
    </div>
    <Select v-model="fnFilter">
      <SelectTrigger class="w-40" aria-label="Función"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">Todas las funciones</SelectItem><SelectItem v-for="(l, k) in FUNCTION_LABELS" :key="k" :value="k">{{ l }}</SelectItem></SelectContent>
    </Select>
    <Select v-model="capabilityFilter">
      <SelectTrigger class="w-44" aria-label="Capacidad"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">Cualquier capacidad</SelectItem><SelectItem v-for="(l, k) in CAPABILITY_LABELS" :key="k" :value="k">{{ l }}</SelectItem></SelectContent>
    </Select>
    <Select v-model="availabilityFilter">
      <SelectTrigger class="w-40" aria-label="Disponibilidad"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Toda disponibilidad</SelectItem><SelectItem value="available">Disponible</SelectItem><SelectItem value="unverified">Sin verificar</SelectItem><SelectItem value="unavailable">No disponible</SelectItem>
      </SelectContent>
    </Select>
    <Select v-model="connectionFilter">
      <SelectTrigger class="w-44" aria-label="Conexión"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">Todas las conexiones</SelectItem><SelectItem v-for="c in connections" :key="c.id" :value="c.id">{{ c.alias }}</SelectItem></SelectContent>
    </Select>
    <Select v-model="query.sort">
      <SelectTrigger class="w-40" aria-label="Orden"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="name">Nombre</SelectItem><SelectItem value="inputPrice">Tarifa de entrada</SelectItem><SelectItem value="context">Contexto</SelectItem></SelectContent>
    </Select>
  </div>

  <EmptyState v-if="data && !data.total && !query.search && !query.function && !query.connectionId" title="Sin modelos" description="Sincroniza una conexión para descubrir sus modelos o impórtalos manualmente con una fuente." :icon="Cpu">
    <Button as-child variant="outline"><NuxtLink to="/admin/ai/connections">Ir a conexiones</NuxtLink></Button>
  </EmptyState>
  <DataTable v-else :columns="columns" :data="data?.items ?? []" :total="data?.total ?? 0" :page="query.page" :page-size="query.pageSize" :loading="status === 'pending'" caption="Modelos del catálogo" @update:page="query.page = $event" />

  <Card v-if="runs?.length">
    <CardHeader><CardTitle class="text-base">Sincronizaciones recientes</CardTitle></CardHeader>
    <CardContent>
      <ul class="divide-y text-sm">
        <li v-for="r in runs.slice(0, 5)" :key="r.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
          <span class="flex items-center gap-2"><StatusBadge :status="r.status" /> <RelativeTime :value="r.startedAt" /></span>
          <span class="text-muted-foreground text-xs">
            <template v-if="r.stats">{{ r.stats.discovered ?? 0 }} desde el proveedor · {{ r.stats.enrichedFromCatalog ?? 0 }} enriquecidos con catálogo · {{ r.stats.catalogOnly ?? 0 }} solo catálogo</template>
            <span v-if="r.error" class="text-destructive"> · {{ r.error }}</span>
          </span>
        </li>
      </ul>
    </CardContent>
  </Card>

  <Dialog v-model:open="importOpen">
    <DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Importar modelo</DialogTitle><DialogDescription>Para modelos que el proveedor no lista. La fuente es obligatoria; el modelo quedará «sin verificar» hasta probarlo.</DialogDescription></DialogHeader>
      <form id="import-form" class="space-y-4" novalidate @submit="submitImport">
        <Field :data-invalid="!!form.errors.connectionId">
          <FieldLabel for="imp-conn">Conexión</FieldLabel>
          <Select v-model="form.values.connectionId">
            <SelectTrigger id="imp-conn"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
            <SelectContent><SelectItem v-for="c in connections" :key="c.id" :value="c.id">{{ c.alias }}</SelectItem></SelectContent>
          </Select>
          <FieldError :errors="[form.errors.connectionId]" />
        </Field>
        <Field :data-invalid="!!form.errors.modelId"><FieldLabel for="imp-id">ID del modelo</FieldLabel><Input id="imp-id" v-model="form.values.modelId" /><FieldError :errors="[form.errors.modelId]" /></Field>
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">Funciones</legend>
          <div class="flex gap-4">
            <div v-for="f in importFunctions" :key="f" class="flex items-center gap-2">
              <Checkbox :id="`imp-fn-${f}`" :model-value="form.values.functions?.includes(f)" @update:model-value="(v) => toggleFunction(f, !!v)" /><Label :for="`imp-fn-${f}`">{{ FUNCTION_LABELS[f] }}</Label>
            </div>
          </div>
          <FieldError :errors="[form.errors.functions]" />
        </fieldset>
        <div class="grid grid-cols-2 gap-3">
          <Field><FieldLabel for="imp-ctx">Contexto (tokens)</FieldLabel><Input id="imp-ctx" v-model.number="form.values.contextWindow" type="number" min="1" /></Field>
          <Field><FieldLabel for="imp-out">Salida máx.</FieldLabel><Input id="imp-out" v-model.number="form.values.maxOutputTokens" type="number" min="1" /></Field>
        </div>
        <Field v-if="form.values.functions?.includes('embedding')"><FieldLabel for="imp-dim">Dimensiones</FieldLabel><Input id="imp-dim" v-model.number="form.values.embeddingDimensions" type="number" min="1" /></Field>
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">Capacidades declaradas</legend>
          <div class="grid grid-cols-2 gap-2">
            <div v-for="(label, k) in CAPABILITY_LABELS" :key="k" class="flex items-center justify-between gap-2 text-sm">
              <span>{{ label }}</span>
              <Select :model-value="capabilityState(k)" @update:model-value="(v) => setCapability(k, String(v))">
                <SelectTrigger class="h-8 w-28" :aria-label="label"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="yes">Sí</SelectItem><SelectItem value="no">No</SelectItem><SelectItem value="unknown">Desconocido</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        </fieldset>
        <Field :data-invalid="!!form.errors.sourceUrl">
          <FieldLabel for="imp-src">Fuente (URL de documentación)</FieldLabel>
          <Input id="imp-src" v-model="form.values.sourceUrl" type="url" />
          <FieldDescription>Evidencia de las capacidades declaradas.</FieldDescription>
          <FieldError :errors="[form.errors.sourceUrl]" />
        </Field>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="import-form" :disabled="form.submitting.value">Importar</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
