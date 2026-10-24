<script setup lang="ts">
import { aiModelsGet, aiModelsUpdate, aiModelsVerify, aiPricesList } from '@starter/api-client';
import { ArrowLeft, ExternalLink } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Badge } from '#ui/components/ui/badge';
import { Switch } from '#ui/components/ui/switch';
import { Label } from '#ui/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { formatDate, formatNumber, formatPerMillion } from '#ui/lib/format';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';

definePageMeta({ permission: 'ai.models.manage', feature: 'ai', breadcrumb: 'Detalle' });
const api = useApi();
const route = useRoute();
const id = computed(() => String(route.params.id));
const { data: model, refresh } = await useAsyncData(`ai-model-${id.value}`, () => unwrap(aiModelsGet({ client: api, path: { id: id.value } })));
const { data: history } = await useAsyncData(
  `ai-model-prices-${id.value}`,
  () => (model.value ? unwrap(aiPricesList({ client: api, query: { provider: model.value.provider, modelId: model.value.modelId, includeHistory: true, page: 1, pageSize: 100 } })) : Promise.resolve(null)),
  { watch: [model] },
);
useHead({ title: () => model.value?.modelId ?? 'Modelo' });

const SOURCE: Record<string, string> = { provider_api: 'API del proveedor', catalog: 'Catálogo estructurado', manual: 'Importación manual' };
const verifying = ref(false);
async function verify() {
  verifying.value = true;
  try {
    const r = await unwrap(aiModelsVerify({ client: api, path: { id: id.value } }));
    if (r.availability === 'available') toast.success(r.message, { description: `${r.latencyMs} ms` });
    else toast.error(r.message);
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  } finally {
    verifying.value = false;
  }
}
async function update(body: { enabled?: boolean; capabilities?: Record<string, 'yes' | 'no' | 'unknown'> }) {
  try {
    await aiModelsUpdate({ client: api, path: { id: id.value }, body });
    toast.success('Modelo actualizado');
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
</script>

<template>
  <div v-if="model" class="space-y-6">
    <Button variant="ghost" size="sm" as-child class="-ml-2"><NuxtLink to="/admin/ai/models"><ArrowLeft class="size-4" /> Modelos</NuxtLink></Button>
    <PageHeader :title="model.displayName ?? model.modelId" :description="`${model.connectionAlias} · ${model.modelId}`">
      <template #actions>
        <div class="flex items-center gap-2"><Switch id="model-enabled" :model-value="model.enabled" @update:model-value="(v: boolean) => update({ enabled: v })" /><Label for="model-enabled">Habilitado</Label></div>
        <Button :disabled="verifying" data-testid="model-verify" @click="verify">Verificar con la credencial</Button>
      </template>
    </PageHeader>

    <div class="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader><CardTitle class="text-base">Ficha</CardTitle></CardHeader>
        <CardContent>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt class="text-muted-foreground">Disponibilidad</dt><dd><StatusBadge :status="model.availability" /></dd>
            <dt class="text-muted-foreground">Última verificación</dt><dd><RelativeTime v-if="model.lastVerifiedAt" :value="model.lastVerifiedAt" /><span v-else>nunca</span></dd>
            <dt class="text-muted-foreground">Funciones</dt><dd class="flex flex-wrap gap-1"><Badge v-for="f in model.functions" :key="f" variant="secondary">{{ FUNCTION_LABELS[f] ?? f }}</Badge></dd>
            <dt class="text-muted-foreground">Entrada</dt><dd>{{ model.inputModalities.join(', ') }}</dd>
            <dt class="text-muted-foreground">Salida</dt><dd>{{ model.outputModalities.join(', ') }}</dd>
            <dt class="text-muted-foreground">Contexto</dt><dd class="tabular-nums">{{ formatNumber(model.contextWindow) }}</dd>
            <dt class="text-muted-foreground">Salida máx.</dt><dd class="tabular-nums">{{ formatNumber(model.maxOutputTokens) }}</dd>
            <template v-if="model.embeddingDimensions"><dt class="text-muted-foreground">Dimensiones</dt><dd class="tabular-nums">{{ model.embeddingDimensions }}</dd></template>
            <dt class="text-muted-foreground">Origen</dt>
            <dd>{{ SOURCE[model.source] }} <a v-if="model.sourceUrl" :href="model.sourceUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 underline-offset-4 hover:underline">fuente <ExternalLink class="size-3" /></a></dd>
            <dt class="text-muted-foreground">Sincronizado</dt><dd><RelativeTime v-if="model.lastSyncedAt" :value="model.lastSyncedAt" /><span v-else>—</span></dd>
          </dl>
        </CardContent>
      </Card>

      <Card class="lg:col-span-2">
        <CardHeader>
          <CardTitle class="text-base">Capacidades</CardTitle>
          <CardDescription>Las verificadas o corregidas manualmente no se sobrescriben en la próxima sincronización.</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-3 sm:grid-cols-2">
          <div v-for="(label, k) in CAPABILITY_LABELS" :key="k" class="flex items-center justify-between gap-2 text-sm">
            <span>{{ label }}</span>
            <Select :model-value="model.capabilities[k] ?? 'unknown'" @update:model-value="(v) => update({ capabilities: { [k]: v as 'yes' | 'no' | 'unknown' } })">
              <SelectTrigger class="h-8 w-36" :aria-label="label" :data-testid="`cap-${k}`"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="yes">Sí</SelectItem><SelectItem value="no">No</SelectItem><SelectItem value="unknown">Desconocido</SelectItem></SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">Tarifas e historial</CardTitle>
        <CardDescription>Cada cambio crea una versión nueva con vigencia; los costos históricos conservan la tarifa aplicada.</CardDescription>
      </CardHeader>
      <CardContent>
        <p v-if="!history?.items.length" class="text-muted-foreground text-sm">Tarifa desconocida. Los consumos de este modelo se registran con costo desconocido. <NuxtLink to="/admin/ai/prices" class="underline">Registrar tarifa</NuxtLink></p>
        <div v-else class="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Unidad</TableHead><TableHead>Precio</TableHead><TableHead>Ámbito</TableHead><TableHead>Fuente</TableHead><TableHead>Vigencia</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow v-for="p in history.items" :key="p.id" :class="{ 'text-muted-foreground': p.effectiveTo }">
                <TableCell>{{ UNIT_LABELS[p.unit] ?? p.unit }}</TableCell>
                <TableCell class="tabular-nums">{{ formatPerMillion(p.price, p.unitQuantity) }}</TableCell>
                <TableCell>{{ p.connectionId ? 'Acuerdo de la conexión' : p.billingScope }}</TableCell>
                <TableCell><a v-if="p.source.url" :href="p.source.url" target="_blank" rel="noopener noreferrer" class="underline-offset-4 hover:underline">{{ p.source.name }}</a><span v-else>{{ p.source.name }}</span></TableCell>
                <TableCell class="text-xs">{{ formatDate(p.effectiveFrom) }} → {{ p.effectiveTo ? formatDate(p.effectiveTo) : 'vigente' }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
