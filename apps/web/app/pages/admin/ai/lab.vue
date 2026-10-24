<script setup lang="ts">
import { aiLabCreate, aiLabGet, aiLabList, aiModelsList, aiRecommendationsCreate, type LabRun, type RecommendationResult } from '@starter/api-client';
import { LabRunInput, RecommendationInput } from '@starter/contracts';
import { FlaskConical, Plus, Sparkles, Trash2 } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Textarea } from '#ui/components/ui/textarea';
import { Badge } from '#ui/components/ui/badge';
import { Switch } from '#ui/components/ui/switch';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Label } from '#ui/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert';
import { formatNumber, formatUsd } from '#ui/lib/format';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';
import ModelSelect from '~/components/shared/ModelSelect.vue';

definePageMeta({ permission: 'ai.lab.use', feature: 'ai' });
useHead({ title: 'Laboratorio de modelos' });
const api = useApi();
const tab = ref<'recommend' | 'compare'>('recommend');
const { data: chatModels } = await useAsyncData('lab-chat-models', () => unwrap(aiModelsList({ client: api, query: { function: 'chat', page: 1, pageSize: 100, sort: 'name' } })));
const modelName = (id: string) => {
  const m = chatModels.value?.items.find((x) => x.id === id);
  return m ? `${m.connectionAlias} · ${m.displayName ?? m.modelId}` : id;
};

// ── recommendation ──────────────────────────────────────────────────────
const rec = useZodForm(RecommendationInput, {
  useCase: '',
  requirements: { function: 'chat', capabilities: [], inputModalities: ['text'], onlyAvailable: true },
  budgetUsd: '0.05',
  maxCandidates: 8,
});
const req = computed(() => rec.values.requirements!);
const evaluator = ref<string | null>(null);
const maxIn = ref('');
const maxOut = ref('');
const minContext = ref<number | undefined>();
function toggle(list: 'capabilities' | 'inputModalities', value: string, on: boolean) {
  const set = new Set(req.value[list] ?? []);
  if (on) set.add(value);
  else set.delete(value);
  req.value[list] = [...set];
}
const recResult = ref<RecommendationResult | null>(null);
const submitRec = rec.handleSubmit(async (values) => {
  recResult.value = await unwrap(
    aiRecommendationsCreate({
      client: api,
      body: {
        ...values,
        evaluatorModelId: evaluator.value ?? undefined,
        requirements: { ...values.requirements, minContext: minContext.value || undefined, maxInputPricePerMillion: maxIn.value || undefined, maxOutputPricePerMillion: maxOut.value || undefined },
      },
    }),
  );
});
const candidateOf = (id: string) => recResult.value?.candidates.find((c) => c.modelCatalogId === id);
function compareRecommended() {
  if (!recResult.value) return;
  cmp.values.modelCatalogIds = recResult.value.recommended.map((r) => r.modelCatalogId).slice(0, 4);
  if (!cmp.values.prompts?.[0]) cmp.values.prompts = [rec.values.useCase];
  tab.value = 'compare';
}

// ── comparison ──────────────────────────────────────────────────────────
const cmp = useZodForm(LabRunInput, { prompts: [''], modelCatalogIds: [], maxOutputTokens: 400, budgetUsd: '0.50', concurrency: 2 });
function toggleModel(id: string, on: boolean) {
  const set = new Set(cmp.values.modelCatalogIds);
  if (on) set.add(id);
  else set.delete(id);
  cmp.values.modelCatalogIds = [...set];
}
const { data: runs, refresh: refreshRuns } = await useAsyncData('lab-runs', () => unwrap(aiLabList({ client: api })));
const current = ref<LabRun | null>(null);
let poll: ReturnType<typeof setTimeout> | undefined;
async function watchRun(id: string) {
  clearTimeout(poll);
  current.value = await unwrap(aiLabGet({ client: api, path: { id } }));
  if (current.value.status === 'queued' || current.value.status === 'running') poll = setTimeout(() => watchRun(id), 1500);
  else await refreshRuns();
}
onBeforeUnmount(() => clearTimeout(poll));
const submitCmp = cmp.handleSubmit(async (values) => {
  const run = await unwrap(aiLabCreate({ client: api, body: { ...values, system: values.system || undefined } }));
  toast.success('Comparación en cola', { description: 'El worker ejecuta las llamadas respetando el presupuesto.' });
  await watchRun(run.id);
});
const runInput = computed(() => (current.value?.input ?? null) as { prompts: string[]; modelCatalogIds: string[] } | null);
const resultFor = (modelId: string, promptIndex: number) => current.value?.results?.find((r) => r.modelCatalogId === modelId && r.promptIndex === promptIndex);
</script>

<template>
  <PageHeader title="Laboratorio de modelos" description="Recomienda modelos a partir de requisitos verificables y compáralos con tus propios prompts. Cada llamada se registra en el libro de consumo." />

  <Tabs v-model="tab">
    <TabsList>
      <TabsTrigger value="recommend"><Sparkles class="size-4" /> Recomendación</TabsTrigger>
      <TabsTrigger value="compare"><FlaskConical class="size-4" /> Comparación</TabsTrigger>
    </TabsList>

    <TabsContent value="recommend" class="grid gap-4 lg:grid-cols-5">
      <Card class="lg:col-span-2">
        <CardHeader><CardTitle class="text-base">Requisitos</CardTitle><CardDescription>Los filtros se aplican de forma determinista sobre el catálogo; el evaluador opcional solo ordena candidatos.</CardDescription></CardHeader>
        <CardContent>
          <form id="rec-form" class="space-y-4" novalidate @submit="submitRec">
            <Field :data-invalid="!!rec.errors.useCase">
              <FieldLabel for="rec-use">Caso de uso</FieldLabel>
              <Textarea id="rec-use" v-model="rec.values.useCase" rows="4" placeholder="Asistente de soporte que responde en español con documentos internos…" data-testid="rec-usecase" />
              <FieldError :errors="[rec.errors.useCase]" />
            </Field>
            <Field>
              <FieldLabel for="rec-fn">Función</FieldLabel>
              <Select v-model="req.function">
                <SelectTrigger id="rec-fn"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="chat">Chat</SelectItem><SelectItem value="embedding">Embeddings</SelectItem><SelectItem value="transcription">Transcripción</SelectItem></SelectContent>
              </Select>
            </Field>
            <fieldset class="space-y-2">
              <legend class="text-sm font-medium">Capacidades obligatorias</legend>
              <div class="grid grid-cols-2 gap-2">
                <div v-for="(l, k) in CAPABILITY_LABELS" :key="k" class="flex items-center gap-2">
                  <Checkbox :id="`rc-${k}`" :model-value="req.capabilities?.includes(k)" @update:model-value="(v) => toggle('capabilities', k, !!v)" /><Label :for="`rc-${k}`" class="text-sm font-normal">{{ l }}</Label>
                </div>
              </div>
            </fieldset>
            <fieldset class="space-y-2">
              <legend class="text-sm font-medium">Modalidades de entrada</legend>
              <div class="flex flex-wrap gap-3">
                <div v-for="m in ['text', 'image', 'pdf', 'audio']" :key="m" class="flex items-center gap-2">
                  <Checkbox :id="`rm-${m}`" :model-value="req.inputModalities?.includes(m)" @update:model-value="(v) => toggle('inputModalities', m, !!v)" /><Label :for="`rm-${m}`" class="text-sm font-normal">{{ m }}</Label>
                </div>
              </div>
            </fieldset>
            <div class="grid grid-cols-3 gap-2">
              <Field><FieldLabel for="rec-ctx">Contexto mín.</FieldLabel><Input id="rec-ctx" v-model.number="minContext" type="number" min="1" /></Field>
              <Field><FieldLabel for="rec-in">Entrada máx. /1M</FieldLabel><Input id="rec-in" v-model="maxIn" inputmode="decimal" placeholder="US$" /></Field>
              <Field><FieldLabel for="rec-out">Salida máx. /1M</FieldLabel><Input id="rec-out" v-model="maxOut" inputmode="decimal" placeholder="US$" /></Field>
            </div>
            <div class="flex items-center gap-2"><Switch id="rec-avail" v-model="req.onlyAvailable" /><Label for="rec-avail">Solo modelos verificados</Label></div>
            <Field>
              <FieldLabel for="rec-eval">Evaluador (opcional)</FieldLabel>
              <ModelSelect id="rec-eval" v-model="evaluator" capability="structured_output" allow-none />
              <FieldDescription>Compara solo los candidatos filtrados; su respuesta se valida y se descartan ids inventados.</FieldDescription>
            </Field>
            <Field v-if="evaluator"><FieldLabel for="rec-budget">Presupuesto del evaluador (USD)</FieldLabel><Input id="rec-budget" v-model="rec.values.budgetUsd" inputmode="decimal" /></Field>
            <Alert v-if="rec.formError.value" variant="destructive"><AlertDescription>{{ rec.formError.value }}</AlertDescription></Alert>
            <Button type="submit" :disabled="rec.submitting.value" data-testid="rec-submit">Recomendar</Button>
          </form>
        </CardContent>
      </Card>

      <div class="space-y-4 lg:col-span-3">
        <EmptyState v-if="!recResult" title="Sin recomendación" description="Describe el caso de uso y los requisitos verificables." :icon="Sparkles" />
        <template v-else>
          <div class="flex flex-wrap items-center gap-2 text-sm" data-testid="rec-result">
            <Badge :variant="recResult.method === 'ai-assisted' ? 'default' : 'secondary'">{{ recResult.method === 'ai-assisted' ? 'Asistida por IA' : 'Determinista' }}</Badge>
            <span class="text-muted-foreground">{{ recResult.candidates.length }} candidatos · {{ recResult.excluded }} excluidos por requisitos</span>
            <span v-if="recResult.evaluator" class="text-muted-foreground">· evaluador {{ recResult.evaluator.modelId }}: {{ formatUsd(recResult.evaluator.costUsd) }}</span>
          </div>
          <Alert v-if="recResult.evaluator?.error"><AlertTitle>Evaluador</AlertTitle><AlertDescription>{{ recResult.evaluator.error }}</AlertDescription></Alert>
          <EmptyState v-if="!recResult.recommended.length" title="Ningún modelo cumple los requisitos" description="Relaja los filtros, verifica modelos o registra tarifas." :icon="FlaskConical" />
          <Card v-for="r in recResult.recommended" :key="r.modelCatalogId" :data-testid="`rec-${r.rank}`">
            <CardHeader>
              <CardTitle class="text-base">#{{ r.rank }} · {{ candidateOf(r.modelCatalogId)?.modelId }}</CardTitle>
              <CardDescription>{{ candidateOf(r.modelCatalogId)?.connectionAlias }} · puntaje {{ candidateOf(r.modelCatalogId)?.score }}</CardDescription>
            </CardHeader>
            <CardContent class="space-y-2 text-sm">
              <p>{{ r.rationale }}</p>
              <p class="text-muted-foreground text-xs">
                Entrada {{ candidateOf(r.modelCatalogId)?.inputPricePerMillion ? formatUsd(candidateOf(r.modelCatalogId)!.inputPricePerMillion) : 'desconocida' }} /1M · salida
                {{ candidateOf(r.modelCatalogId)?.outputPricePerMillion ? formatUsd(candidateOf(r.modelCatalogId)!.outputPricePerMillion) : 'desconocida' }} /1M
              </p>
            </CardContent>
          </Card>
          <Button v-if="recResult.recommended.length && req.function === 'chat'" variant="outline" @click="compareRecommended">Comparar recomendados con mis prompts</Button>
        </template>
      </div>
    </TabsContent>

    <TabsContent value="compare" class="space-y-4">
      <Card>
        <CardHeader><CardTitle class="text-base">Nueva comparación</CardTitle><CardDescription>Se ejecuta como trabajo durable con límite de presupuesto y concurrencia; los modelos sin tarifa se omiten si no se puede acotar el gasto.</CardDescription></CardHeader>
        <CardContent>
          <form id="cmp-form" class="grid gap-4 lg:grid-cols-2" novalidate @submit="submitCmp">
            <fieldset class="space-y-2">
              <legend class="text-sm font-medium">Modelos (máx. 8)</legend>
              <div class="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                <div v-for="m in chatModels?.items.filter((x) => x.enabled)" :key="m.id" class="flex items-center gap-2">
                  <Checkbox :id="`cm-${m.id}`" :model-value="cmp.values.modelCatalogIds?.includes(m.id)" :data-testid="`cmp-model-${m.modelId}`" @update:model-value="(v) => toggleModel(m.id, !!v)" />
                  <Label :for="`cm-${m.id}`" class="text-sm font-normal">{{ m.connectionAlias }} · {{ m.displayName ?? m.modelId }}</Label>
                  <StatusBadge v-if="m.availability !== 'available'" :status="m.availability" />
                </div>
                <p v-if="!chatModels?.items.length" class="text-muted-foreground p-2 text-sm">No hay modelos de chat. Sincroniza una conexión.</p>
              </div>
              <FieldError :errors="[cmp.errors.modelCatalogIds]" />
            </fieldset>
            <div class="space-y-3">
              <Field><FieldLabel for="cmp-sys">Instrucciones de sistema (opcional)</FieldLabel><Textarea id="cmp-sys" v-model="cmp.values.system" rows="2" /></Field>
              <div v-for="(_, i) in cmp.values.prompts" :key="i" class="flex items-start gap-2">
                <Textarea v-model="cmp.values.prompts![i]" rows="2" :aria-label="`Prompt ${i + 1}`" :placeholder="`Prompt ${i + 1}`" :data-testid="`cmp-prompt-${i}`" />
                <Button v-if="(cmp.values.prompts?.length ?? 0) > 1" type="button" variant="ghost" size="icon" aria-label="Quitar prompt" @click="cmp.values.prompts!.splice(i, 1)"><Trash2 class="size-4" /></Button>
              </div>
              <Button type="button" variant="outline" size="sm" :disabled="(cmp.values.prompts?.length ?? 0) >= 10" @click="cmp.values.prompts!.push('')"><Plus class="size-4" /> Agregar prompt</Button>
              <FieldError :errors="[cmp.errors.prompts, cmp.errors['prompts.0']]" />
              <div class="grid grid-cols-3 gap-2">
                <Field><FieldLabel for="cmp-max">Salida máx.</FieldLabel><Input id="cmp-max" v-model.number="cmp.values.maxOutputTokens" type="number" min="16" max="8000" /></Field>
                <Field><FieldLabel for="cmp-budget">Presupuesto US$</FieldLabel><Input id="cmp-budget" v-model="cmp.values.budgetUsd" inputmode="decimal" /></Field>
                <Field><FieldLabel for="cmp-conc">Concurrencia</FieldLabel><Input id="cmp-conc" v-model.number="cmp.values.concurrency" type="number" min="1" max="4" /></Field>
              </div>
              <Alert v-if="cmp.formError.value" variant="destructive"><AlertDescription>{{ cmp.formError.value }}</AlertDescription></Alert>
              <Button type="submit" :disabled="cmp.submitting.value || current?.status === 'running' || current?.status === 'queued'" data-testid="cmp-submit">Ejecutar comparación</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card v-if="current" data-testid="lab-run">
        <CardHeader>
          <CardTitle class="flex items-center gap-2 text-base">Resultado <StatusBadge :status="current.status" data-testid="lab-run-status" /></CardTitle>
          <CardDescription>Gastado {{ formatUsd(current.spentUsd) }} de {{ formatUsd(current.budgetUsd) }}<span v-if="current.error"> · {{ current.error }}</span></CardDescription>
        </CardHeader>
        <CardContent v-if="runInput" class="space-y-6">
          <section v-for="(prompt, pi) in runInput.prompts" :key="pi" class="space-y-2">
            <h3 class="text-sm font-medium">Prompt {{ pi + 1 }}: <span class="text-muted-foreground font-normal">{{ prompt }}</span></h3>
            <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div v-for="mid in runInput.modelCatalogIds" :key="mid" class="space-y-2 rounded-md border p-3 text-sm" :data-testid="`lab-cell-${pi}`">
                <div class="font-medium">{{ modelName(mid) }}</div>
                <template v-if="resultFor(mid, pi)">
                  <p v-if="resultFor(mid, pi)!.text" class="whitespace-pre-wrap">{{ resultFor(mid, pi)!.text }}</p>
                  <p v-if="resultFor(mid, pi)!.error" class="text-destructive text-xs">{{ resultFor(mid, pi)!.skipped ? 'Omitido: ' : '' }}{{ resultFor(mid, pi)!.error }}</p>
                  <dl class="text-muted-foreground grid grid-cols-2 gap-x-2 text-xs tabular-nums">
                    <dt>Latencia</dt><dd>{{ formatNumber(resultFor(mid, pi)!.latencyMs) }} ms</dd>
                    <dt>Primer token</dt><dd>{{ formatNumber(resultFor(mid, pi)!.timeToFirstTokenMs) }} ms</dd>
                    <dt>Tokens ↑/↓</dt><dd>{{ formatNumber(resultFor(mid, pi)!.inputTokens) }} / {{ formatNumber(resultFor(mid, pi)!.outputTokens) }}</dd>
                    <dt>Costo</dt><dd>{{ resultFor(mid, pi)!.costStatus === 'unknown' ? 'desconocido' : formatUsd(resultFor(mid, pi)!.costUsd) }}</dd>
                  </dl>
                </template>
                <p v-else class="text-muted-foreground text-xs">Pendiente…</p>
              </div>
            </div>
          </section>
        </CardContent>
      </Card>

      <Card v-if="runs?.length">
        <CardHeader><CardTitle class="text-base">Ejecuciones anteriores</CardTitle></CardHeader>
        <CardContent>
          <ul class="divide-y text-sm">
            <li v-for="r in runs" :key="r.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
              <span class="flex items-center gap-2"><StatusBadge :status="r.status" /> <RelativeTime :value="r.createdAt" /> · {{ formatUsd(r.spentUsd) }}</span>
              <Button variant="ghost" size="sm" @click="watchRun(r.id)">Ver</Button>
            </li>
          </ul>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
</template>
