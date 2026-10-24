<script setup lang="ts">
import {
  ragEvaluationsCreate,
  ragEvaluationsDelete,
  ragEvaluationsList,
  ragEvaluationsRate,
  ragEvaluationsRun,
  ragEvaluationsRuns,
  ragEvaluationsUpdate,
  ragSearch,
  type EvaluationRun,
  type EvaluationSet,
  type SearchResult,
} from '@starter/api-client';
import { Copy, FlaskConical, Play, Plus, Search, Star, Trash2 } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Textarea } from '#ui/components/ui/textarea';
import { Badge } from '#ui/components/ui/badge';
import { Switch } from '#ui/components/ui/switch';
import { Label } from '#ui/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { Spinner } from '#ui/components/ui/spinner';
import { formatNumber, formatUsd } from '#ui/lib/format';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import CollectionsSelect from '~/components/shared/CollectionsSelect.vue';

definePageMeta({ permission: 'rag.playground.use', feature: 'rag' });
useHead({ title: 'Laboratorio de búsqueda' });
const api = useApi();
const { confirm } = useConfirm();
type Method = 'vector' | 'fulltext' | 'hybrid';
const METHODS: Method[] = ['hybrid', 'vector', 'fulltext'];

// ── search ──────────────────────────────────────────────────────────────
const form = reactive({ query: '', collectionIds: [] as string[], method: 'hybrid' as Method, topK: 8, minScore: 0, compare: false });
const results = ref<{ method: Method; result?: SearchResult; error?: string }[]>([]);
const searching = ref(false);
async function runSearch() {
  if (!form.query.trim() || !form.collectionIds.length) return;
  searching.value = true;
  const methods = form.compare ? METHODS : [form.method];
  results.value = await Promise.all(
    methods.map(async (method) => {
      try {
        const result = await unwrap(ragSearch({ client: api, body: { query: form.query, collectionIds: form.collectionIds, method, topK: form.topK, minScore: form.minScore } }));
        return { method, result };
      } catch (err) {
        return { method, error: apiError(err).message };
      }
    }),
  );
  searching.value = false;
}
async function copy(text: string) {
  await navigator.clipboard.writeText(text).catch(() => undefined);
  toast.success('Identificador copiado');
}

// ── evaluation sets ─────────────────────────────────────────────────────
const { data: sets, refresh: refreshSets } = await useAsyncData('rag-eval-sets', () => unwrap(ragEvaluationsList({ client: api })));
interface CaseDraft {
  id: string;
  question: string;
  relevant: string;
  expectedAnswer: string;
}
const editor = reactive({ open: false, id: null as string | null, name: '', description: '', collectionIds: [] as string[], cases: [] as CaseDraft[], error: null as string | null });
function newCase(i: number): CaseDraft {
  return { id: `c${i}`, question: '', relevant: '', expectedAnswer: '' };
}
function openEditor(set?: EvaluationSet) {
  Object.assign(editor, {
    open: true,
    error: null,
    id: set?.id ?? null,
    name: set?.name ?? '',
    description: set?.description ?? '',
    collectionIds: set ? [...set.collectionIds] : [...form.collectionIds],
    cases: set ? set.cases.map((c) => ({ id: c.id, question: c.question, relevant: c.relevantDocumentIds.join(', '), expectedAnswer: c.expectedAnswer ?? '' })) : [newCase(1)],
  });
}
function addCase() {
  const used = new Set(editor.cases.map((c) => c.id));
  let i = editor.cases.length + 1;
  while (used.has(`c${i}`)) i++;
  editor.cases.push(newCase(i));
}
async function saveSet() {
  editor.error = null;
  const body = {
    name: editor.name,
    description: editor.description || null,
    collectionIds: editor.collectionIds,
    cases: editor.cases
      .filter((c) => c.question.trim())
      .map((c) => ({
        id: c.id,
        question: c.question,
        relevantDocumentIds: c.relevant
          .split(/[\s,]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        ...(c.expectedAnswer.trim() ? { expectedAnswer: c.expectedAnswer } : {}),
      })),
  };
  try {
    if (editor.id) await ragEvaluationsUpdate({ client: api, path: { id: editor.id }, body });
    else await ragEvaluationsCreate({ client: api, body });
    editor.open = false;
    toast.success('Conjunto guardado');
    await refreshSets();
  } catch (err) {
    editor.error = apiError(err).message;
  }
}
async function removeSet(set: EvaluationSet) {
  if (!(await confirm({ title: `¿Eliminar «${set.name}»?`, description: 'Se eliminan también sus resultados y calificaciones.', confirmLabel: 'Eliminar', destructive: true }))) return;
  try {
    await ragEvaluationsDelete({ client: api, path: { id: set.id } });
    if (selected.value?.id === set.id) selected.value = null;
    await refreshSets();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}

// ── runs ────────────────────────────────────────────────────────────────
const selected = ref<EvaluationSet | null>(null);
const runs = ref<EvaluationRun[]>([]);
async function selectSet(set: EvaluationSet) {
  selected.value = set;
  runs.value = await unwrap(ragEvaluationsRuns({ client: api, path: { id: set.id } })).catch(() => []);
}
const runForm = reactive({ open: false, label: '', method: 'hybrid' as Method, topK: 6, running: false });
function openRun(set: EvaluationSet) {
  selected.value = set;
  Object.assign(runForm, { open: true, label: `${runForm.method}-k${runForm.topK}`, running: false });
}
watch(() => [runForm.method, runForm.topK], () => (runForm.label = `${runForm.method}-k${runForm.topK}`));
async function run() {
  if (!selected.value) return;
  runForm.running = true;
  try {
    await ragEvaluationsRun({ client: api, path: { id: selected.value.id }, body: { label: runForm.label, method: runForm.method, topK: runForm.topK } });
    runForm.open = false;
    toast.success('Evaluación completada');
    await selectSet(selected.value);
  } catch (err) {
    toast.error(apiError(err).message);
  } finally {
    runForm.running = false;
  }
}
const expanded = ref<string | null>(null);
async function rate(r: EvaluationRun, caseId: string, rating: number) {
  if (!selected.value) return;
  try {
    await ragEvaluationsRate({ client: api, path: { id: selected.value.id }, body: { runLabel: r.label, caseId, rating } });
    const c = r.cases.find((x) => x.caseId === caseId);
    if (c) c.humanRating = rating;
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
function pct(v: number | null) {
  return v === null ? '—' : `${Math.round(v * 100)} %`;
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Laboratorio de búsqueda" description="Prueba consultas contra tus colecciones con tus propios permisos, compara métodos y mide la calidad con conjuntos de evaluación." />

    <Tabs default-value="search">
      <TabsList>
        <TabsTrigger value="search"><Search class="size-4" /> Búsqueda</TabsTrigger>
        <TabsTrigger value="evaluations"><FlaskConical class="size-4" /> Evaluaciones</TabsTrigger>
      </TabsList>

      <TabsContent value="search" class="space-y-6">
        <Card>
          <CardContent class="grid gap-4 pt-6 lg:grid-cols-[1fr_20rem]">
            <form id="search-form" class="space-y-4" @submit.prevent="runSearch">
              <Field>
                <FieldLabel for="q">Consulta</FieldLabel>
                <Textarea id="q" v-model="form.query" rows="3" placeholder="¿Cuántos días de vacaciones tengo?" data-testid="lab-query" @keydown.enter.exact.prevent="runSearch" />
              </Field>
              <div class="flex flex-wrap items-end gap-3">
                <Field class="w-44">
                  <FieldLabel for="m">Método</FieldLabel>
                  <Select v-model="form.method" :disabled="form.compare">
                    <SelectTrigger id="m" data-testid="lab-method"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem v-for="m in METHODS" :key="m" :value="m">{{ SEARCH_METHOD_LABELS[m] }}</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field class="w-24"><FieldLabel for="k">Top K</FieldLabel><Input id="k" v-model.number="form.topK" type="number" min="1" max="50" /></Field>
                <Field class="w-28"><FieldLabel for="ms">Puntaje mín.</FieldLabel><Input id="ms" v-model.number="form.minScore" type="number" min="0" max="1" step="0.05" /></Field>
                <div class="flex items-center gap-2 pb-2"><Switch id="cmp" v-model="form.compare" data-testid="lab-compare" /><Label for="cmp">Comparar los tres métodos</Label></div>
              </div>
              <Button type="submit" :disabled="searching || !form.query.trim() || !form.collectionIds.length" data-testid="lab-search"><Spinner v-if="searching" /><Search v-else class="size-4" /> Buscar</Button>
            </form>
            <Field>
              <FieldLabel>Colecciones</FieldLabel>
              <CollectionsSelect v-model="form.collectionIds" />
              <FieldDescription>Se aplican los permisos por colección y por documento de tu cuenta.</FieldDescription>
            </Field>
          </CardContent>
        </Card>

        <div v-if="results.length" class="grid gap-4" :class="results.length > 1 ? 'xl:grid-cols-3' : ''" data-testid="lab-results">
          <Card v-for="r in results" :key="r.method" :data-method="r.method">
            <CardHeader>
              <CardTitle class="text-base">{{ SEARCH_METHOD_LABELS[r.method] }}</CardTitle>
              <CardDescription v-if="r.result">
                {{ r.result.hits.length }} resultados · {{ formatNumber(r.result.latencyMs) }} ms<template v-if="r.result.embeddingCostUsd"> · embeddings {{ formatUsd(r.result.embeddingCostUsd) }}</template>
                <template v-if="r.result.method !== r.method"> · ejecutado como {{ SEARCH_METHOD_LABELS[r.result.method] ?? r.result.method }}</template>
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-3">
              <Alert v-if="r.error" variant="destructive"><AlertDescription>{{ r.error }}</AlertDescription></Alert>
              <Alert v-for="w in r.result?.warnings" :key="w"><AlertDescription>{{ w }}</AlertDescription></Alert>
              <ol class="space-y-3">
                <li v-for="(h, i) in r.result?.hits" :key="h.chunkId" class="rounded-md border p-3 text-sm" data-testid="lab-hit">
                  <div class="mb-1 flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate font-medium">{{ i + 1 }}. {{ h.title ?? h.documentId }}</p>
                      <p class="text-muted-foreground text-xs">
                        <template v-if="h.heading">{{ h.heading }} · </template><template v-if="h.page">página {{ h.page }} · </template>{{ h.score.toFixed(4) }} ({{ SCORE_TYPE_LABELS[h.scoreType] ?? h.scoreType }})
                        <template v-if="h.vectorRank"> · vectorial #{{ h.vectorRank }}</template><template v-if="h.textRank"> · texto #{{ h.textRank }}</template>
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" class="size-7 shrink-0" :aria-label="`Copiar identificador del documento ${h.title ?? h.documentId}`" @click="copy(h.documentId)"><Copy class="size-3.5" /></Button>
                  </div>
                  <p class="line-clamp-5 whitespace-pre-wrap">{{ h.text }}</p>
                  <a v-if="h.sourceUrl" :href="h.sourceUrl" target="_blank" rel="noopener noreferrer" class="text-muted-foreground mt-1 block truncate text-xs underline">{{ h.sourceUrl }}</a>
                </li>
              </ol>
              <p v-if="r.result && !r.result.hits.length" class="text-muted-foreground text-sm">Sin resultados. Revisa el puntaje mínimo, los permisos o si la colección terminó de indexarse.</p>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="evaluations" class="space-y-6">
        <div class="flex items-center justify-between gap-2">
          <p class="text-muted-foreground text-sm">Cada caso indica qué documentos deberían aparecer; se mide recall@k, latencia y costo por configuración.</p>
          <Button data-testid="eval-new" @click="openEditor()"><Plus class="size-4" /> Nuevo conjunto</Button>
        </div>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card v-for="s in sets" :key="s.id" :class="selected?.id === s.id ? 'ring-primary ring-2' : ''" :data-testid="`eval-set-${s.name}`">
            <CardHeader>
              <CardTitle class="text-base">{{ s.name }}</CardTitle>
              <CardDescription>{{ s.cases.length }} casos · {{ s.collectionIds.length }} colección(es) · actualizado <RelativeTime :value="s.updatedAt" /></CardDescription>
            </CardHeader>
            <CardContent class="flex flex-wrap gap-2">
              <Button size="sm" data-testid="eval-run" @click="openRun(s)"><Play class="size-4" /> Ejecutar</Button>
              <Button size="sm" variant="outline" @click="selectSet(s)">Resultados</Button>
              <Button size="sm" variant="ghost" @click="openEditor(s)">Editar</Button>
              <Button size="sm" variant="ghost" class="text-destructive" :aria-label="`Eliminar ${s.name}`" @click="removeSet(s)"><Trash2 class="size-4" /></Button>
            </CardContent>
          </Card>
          <p v-if="!sets?.length" class="text-muted-foreground text-sm">Aún no hay conjuntos. Busca primero, copia los identificadores de los documentos correctos y crea un conjunto con esas preguntas.</p>
        </div>

        <Card v-if="selected" data-testid="eval-runs">
          <CardHeader>
            <CardTitle class="text-base">Resultados de «{{ selected.name }}»</CardTitle>
            <CardDescription>Ejecuta el conjunto con distintas configuraciones para compararlas. Una etiqueta repetida reemplaza su resultado anterior.</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Configuración</TableHead><TableHead>Recall@k</TableHead><TableHead>Latencia media</TableHead><TableHead>Costo</TableHead><TableHead>Ejecutado</TableHead><TableHead class="sr-only">Detalle</TableHead></TableRow></TableHeader>
                <TableBody>
                  <template v-for="r in runs" :key="r.label">
                    <TableRow :data-testid="`eval-run-${r.label}`">
                      <TableCell><span class="font-medium">{{ r.label }}</span><div class="text-muted-foreground text-xs">{{ SEARCH_METHOD_LABELS[r.method] ?? r.method }} · k={{ r.topK }}</div></TableCell>
                      <TableCell class="tabular-nums" data-testid="eval-recall">{{ pct(r.meanRecall) }}</TableCell>
                      <TableCell class="tabular-nums">{{ r.meanLatencyMs === null ? '—' : `${formatNumber(r.meanLatencyMs)} ms` }}</TableCell>
                      <TableCell class="tabular-nums">{{ r.costUsd === null ? 'sin costo' : formatUsd(r.costUsd) }}</TableCell>
                      <TableCell class="text-sm"><RelativeTime :value="r.createdAt" /></TableCell>
                      <TableCell class="text-right"><Button variant="ghost" size="sm" @click="expanded = expanded === r.label ? null : r.label">{{ expanded === r.label ? 'Ocultar' : 'Casos' }}</Button></TableCell>
                    </TableRow>
                    <TableRow v-if="expanded === r.label">
                      <TableCell colspan="6" class="bg-muted/30">
                        <ul class="space-y-2">
                          <li v-for="c in r.cases" :key="c.caseId" class="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <div class="min-w-0 flex-1">
                              <p class="font-medium">{{ c.question }}</p>
                              <p class="text-muted-foreground text-xs">recall {{ pct(c.recallAtK) }} · {{ c.retrievedDocumentIds.length }} documentos recuperados<template v-if="c.latencyMs !== null"> · {{ c.latencyMs }} ms</template></p>
                            </div>
                            <div class="flex items-center gap-0.5" role="group" :aria-label="`Calificación humana de «${c.question}»`">
                              <button v-for="n in 5" :key="n" type="button" class="rounded p-0.5" :aria-label="`${n} de 5`" :aria-pressed="(c.humanRating ?? 0) >= n" @click="rate(r, c.caseId, n)">
                                <Star class="size-4" :class="(c.humanRating ?? 0) >= n ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'" />
                              </button>
                            </div>
                          </li>
                        </ul>
                      </TableCell>
                    </TableRow>
                  </template>
                  <TableRow v-if="!runs.length"><TableCell colspan="6" class="text-muted-foreground text-center">Sin ejecuciones todavía.</TableCell></TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>

    <Dialog v-model:open="editor.open">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{{ editor.id ? 'Editar conjunto' : 'Nuevo conjunto de evaluación' }}</DialogTitle><DialogDescription>Los identificadores de documentos se copian desde los resultados de búsqueda o la vista de documentos.</DialogDescription></DialogHeader>
        <form id="eval-form" class="space-y-4" @submit.prevent="saveSet">
          <Field><FieldLabel for="ev-name">Nombre</FieldLabel><Input id="ev-name" v-model="editor.name" required data-testid="eval-name" /></Field>
          <Field><FieldLabel for="ev-desc">Descripción</FieldLabel><Input id="ev-desc" v-model="editor.description" /></Field>
          <Field><FieldLabel>Colecciones</FieldLabel><CollectionsSelect v-model="editor.collectionIds" /></Field>
          <fieldset class="space-y-3">
            <legend class="mb-2 text-sm font-medium">Casos</legend>
            <div v-for="(c, i) in editor.cases" :key="c.id" class="space-y-2 rounded-md border p-3">
              <div class="flex items-center justify-between gap-2">
                <Badge variant="outline">{{ c.id }}</Badge>
                <Button v-if="editor.cases.length > 1" type="button" variant="ghost" size="icon" class="size-7" :aria-label="`Quitar caso ${c.id}`" @click="editor.cases.splice(i, 1)"><Trash2 class="size-3.5" /></Button>
              </div>
              <Input v-model="c.question" placeholder="Pregunta" :aria-label="`Pregunta del caso ${c.id}`" data-testid="eval-question" />
              <Input v-model="c.relevant" placeholder="Documentos relevantes (identificadores separados por coma)" :aria-label="`Documentos relevantes del caso ${c.id}`" class="font-mono text-xs" data-testid="eval-relevant" />
              <Textarea v-model="c.expectedAnswer" rows="2" placeholder="Respuesta esperada (opcional, referencia para calificar)" :aria-label="`Respuesta esperada del caso ${c.id}`" />
            </div>
            <Button type="button" variant="outline" size="sm" @click="addCase"><Plus class="size-4" /> Agregar caso</Button>
          </fieldset>
          <Alert v-if="editor.error" variant="destructive"><AlertDescription>{{ editor.error }}</AlertDescription></Alert>
        </form>
        <DialogFooter><Button type="submit" form="eval-form" :disabled="!editor.collectionIds.length" data-testid="eval-save">Guardar</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="runForm.open">
      <DialogContent>
        <DialogHeader><DialogTitle>Ejecutar «{{ selected?.name }}»</DialogTitle><DialogDescription>Cada pregunta se busca con esta configuración. Las búsquedas vectoriales generan costo de embeddings.</DialogDescription></DialogHeader>
        <div class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel for="run-m">Método</FieldLabel>
            <Select v-model="runForm.method">
              <SelectTrigger id="run-m"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem v-for="m in METHODS" :key="m" :value="m">{{ SEARCH_METHOD_LABELS[m] }}</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel for="run-k">Top K</FieldLabel><Input id="run-k" v-model.number="runForm.topK" type="number" min="1" max="50" /></Field>
          <Field class="col-span-2"><FieldLabel for="run-l">Etiqueta</FieldLabel><Input id="run-l" v-model="runForm.label" maxlength="60" /></Field>
        </div>
        <DialogFooter><Button :disabled="runForm.running || !runForm.label" data-testid="eval-run-submit" @click="run"><Spinner v-if="runForm.running" /> Ejecutar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
