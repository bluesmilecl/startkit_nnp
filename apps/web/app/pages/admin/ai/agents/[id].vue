<script setup lang="ts">
import { aiAgentsDiscardDraft, aiAgentsGet, aiAgentsPublish, aiAgentsRollback, aiAgentsSaveDraft, aiAgentsTest, aiAgentsUpdate, type AgentTestResult, type AgentVersion } from '@starter/api-client';
import { ADMIN_TOOLS, AgentConfig, PERMISSION_KEYS, type AdminToolKey } from '@starter/contracts';
import { ArrowLeft, CircleAlert, CircleCheck, Plus, Trash2, TriangleAlert } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Textarea } from '#ui/components/ui/textarea';
import { Badge } from '#ui/components/ui/badge';
import { Switch } from '#ui/components/ui/switch';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Label } from '#ui/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert';
import { formatDate, formatUsd } from '#ui/lib/format';
import ModelSelect from '~/components/shared/ModelSelect.vue';
import CollectionsSelect from '~/components/shared/CollectionsSelect.vue';
import JsonDiff from '~/components/shared/JsonDiff.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';

definePageMeta({ permission: 'ai.agents.manage', feature: 'ai' });
const api = useApi();
const route = useRoute();
const { confirm } = useConfirm();
const id = computed(() => String(route.params.id));
const { data: agent, refresh } = await useAsyncData(`ai-agent-${id.value}`, () => unwrap(aiAgentsGet({ client: api, path: { id: id.value } })));
useHead({ title: () => agent.value?.name ?? 'Agente' });

const draft = computed(() => agent.value?.versions.find((v) => v.status === 'draft') ?? null);
const published = computed(() => agent.value?.versions.find((v) => v.status === 'published') ?? null);
const base = computed(() => draft.value ?? published.value);

// Editable copy of the draft (or of the published version until the first save).
const config = ref<AgentConfig>(AgentConfig.parse({}));
const baseline = ref('');
watch(
  base,
  (v) => {
    config.value = AgentConfig.parse(structuredClone(toRaw(v?.config) ?? {}));
    baseline.value = JSON.stringify(config.value);
  },
  { immediate: true },
);
const dirty = computed(() => JSON.stringify(config.value) !== baseline.value);
const notes = ref('');

const saving = ref(false);
async function save() {
  saving.value = true;
  try {
    // Empty rows added in the editor (fallbacks, suggestions) are not part of the configuration.
    const body = structuredClone(toRaw(config.value));
    body.model.fallbackModelIds = body.model.fallbackModelIds.filter(Boolean);
    body.ui.suggestions = body.ui.suggestions.map((x) => x.trim()).filter(Boolean);
    await aiAgentsSaveDraft({ client: api, path: { id: id.value }, body: { config: body, notes: notes.value || null, expectedUpdatedAt: draft.value?.updatedAt } });
    toast.success('Borrador guardado');
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  } finally {
    saving.value = false;
  }
}
async function publish() {
  if (!draft.value) return;
  if (!(await confirm({ title: `¿Publicar la versión ${draft.value.version}?`, description: 'El chat empezará a usarla en el siguiente mensaje. La versión publicada actual quedará archivada y podrás restaurarla.', confirmLabel: 'Publicar' }))) return;
  try {
    await aiAgentsPublish({ client: api, path: { id: id.value }, body: { versionId: draft.value.id } });
    toast.success('Versión publicada');
    await refresh();
  } catch (err) {
    const e = apiError(err);
    toast.error(e.message);
    await refresh();
  }
}
async function discard() {
  if (!(await confirm({ title: '¿Descartar el borrador?', description: 'Se pierden los cambios no publicados.', confirmLabel: 'Descartar', destructive: true }))) return;
  try {
    await aiAgentsDiscardDraft({ client: api, path: { id: id.value } });
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function rollback(v: AgentVersion) {
  if (!(await confirm({ title: `¿Restaurar la versión ${v.version}?`, description: 'Se publicará una copia como nueva versión; el historial se conserva.', confirmLabel: 'Restaurar' }))) return;
  try {
    await aiAgentsRollback({ client: api, path: { id: id.value }, body: { versionId: v.id } });
    toast.success(`Versión ${v.version} restaurada`);
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function rename(name: string) {
  if (!name.trim() || name === agent.value?.name) return;
  await aiAgentsUpdate({ client: api, path: { id: id.value }, body: { name: name.trim() } }).catch((err) => toast.error(apiError(err).message));
  await refresh();
}

// ── field helpers ───────────────────────────────────────────────────────
const fallbacks = computed(() => config.value.model.fallbackModelIds);
const temperature = computed({
  get: () => (config.value.model.temperature === null ? '' : String(config.value.model.temperature)),
  set: (v: string) => (config.value.model.temperature = v === '' ? null : Math.min(2, Math.max(0, Number(v)))),
});
const toolGroups = computed(() => {
  const groups: Record<string, AdminToolKey[]> = { Usuarios: [], Roles: [], Permisos: [] };
  for (const k of Object.keys(ADMIN_TOOLS) as AdminToolKey[]) groups[k.startsWith('users_') ? 'Usuarios' : k.startsWith('roles_') ? 'Roles' : 'Permisos']!.push(k);
  return groups;
});
function toggleTool(k: AdminToolKey, on: boolean) {
  const set = new Set(config.value.tools.admin);
  if (on) set.add(k);
  else set.delete(k);
  config.value.tools.admin = [...set];
}
function toggleType(t: 'image' | 'pdf' | 'text', on: boolean) {
  const set = new Set(config.value.media.allowedTypes);
  if (on) set.add(t);
  else set.delete(t);
  config.value.media.allowedTypes = [...set];
}
const maxFileMb = computed({ get: () => Math.round(config.value.media.maxFileBytes / 1024 / 1024), set: (v: number) => (config.value.media.maxFileBytes = Math.max(1, v) * 1024 * 1024) });
const transcriptionModel = computed({ get: () => config.value.media.transcriptionModelId, set: (v: string | null) => (config.value.media.transcriptionModelId = v) });
const primaryModel = computed({ get: () => config.value.model.primaryModelId, set: (v: string | null) => (config.value.model.primaryModelId = v) });
const issues = computed(() => draft.value?.validation?.issues ?? []);

// ── versions & test ─────────────────────────────────────────────────────
const diffOf = ref<AgentVersion | null>(null);
const diff = computed(() => (diffOf.value ? changedPaths(published.value?.config ?? {}, diffOf.value.config) : null));
const testVersion = ref<string>('');
watch(
  () => [draft.value?.id, published.value?.id],
  () => (testVersion.value = draft.value?.id ?? published.value?.id ?? ''),
  { immediate: true },
);
const testMessage = ref('');
const testing = ref(false);
const testResult = ref<AgentTestResult | null>(null);
const testError = ref<string | null>(null);
async function runTest() {
  testing.value = true;
  testError.value = null;
  testResult.value = null;
  try {
    testResult.value = await unwrap(aiAgentsTest({ client: api, path: { id: id.value }, body: { versionId: testVersion.value, message: testMessage.value } }));
  } catch (err) {
    testError.value = apiError(err).message;
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div v-if="agent" class="space-y-6">
    <Button variant="ghost" size="sm" as-child class="-ml-2"><NuxtLink to="/admin/ai/agents"><ArrowLeft class="size-4" /> Agentes</NuxtLink></Button>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="space-y-1">
        <Input :model-value="agent.name" class="h-auto border-transparent px-0 text-2xl font-semibold md:text-2xl shadow-none focus-visible:border-input focus-visible:px-2" aria-label="Nombre del agente" @change="(e: Event) => rename((e.target as HTMLInputElement).value)" />
        <div class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          {{ agent.key }}
          <Badge v-if="agent.isDefault" variant="secondary">chat flotante</Badge>
          <span v-if="published">· Publicado v{{ published.version }}</span>
          <span v-else>· Sin versión publicada</span>
          <span v-if="draft">· Borrador v{{ draft.version }}</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button v-if="draft && published" variant="ghost" @click="discard">Descartar borrador</Button>
        <Button variant="outline" :disabled="saving || !dirty" data-testid="agent-save" @click="save">{{ draft ? 'Guardar borrador' : 'Crear borrador' }}</Button>
        <Button :disabled="!draft || dirty || draft.validation?.ok === false" data-testid="agent-publish" @click="publish">Publicar</Button>
      </div>
    </div>

    <Alert v-if="dirty"><AlertDescription>Cambios sin guardar. Guarda el borrador para validarlo contra el catálogo.</AlertDescription></Alert>
    <Card v-if="draft?.validation" data-testid="agent-validation">
      <CardHeader class="pb-2">
        <CardTitle class="flex items-center gap-2 text-base">
          <CircleCheck v-if="draft.validation.ok" class="size-4 text-green-600" aria-hidden="true" />
          <CircleAlert v-else class="text-destructive size-4" aria-hidden="true" />
          {{ draft.validation.ok ? 'El borrador se puede publicar' : 'El borrador tiene errores' }}
        </CardTitle>
      </CardHeader>
      <CardContent v-if="issues.length">
        <ul class="space-y-1 text-sm">
          <li v-for="(i, n) in issues" :key="n" class="flex items-start gap-2" :data-severity="i.severity">
            <CircleAlert v-if="i.severity === 'error'" class="text-destructive mt-0.5 size-4 shrink-0" aria-label="Error" />
            <TriangleAlert v-else class="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Advertencia" />
            <span>{{ i.message }} <span class="text-muted-foreground font-mono text-xs">({{ i.path }})</span></span>
          </li>
        </ul>
      </CardContent>
    </Card>

    <Tabs default-value="model">
      <TabsList class="flex h-auto flex-wrap">
        <TabsTrigger value="model">Modelo</TabsTrigger>
        <TabsTrigger value="instructions">Instrucciones</TabsTrigger>
        <TabsTrigger value="tools">Herramientas</TabsTrigger>
        <TabsTrigger value="knowledge">Conocimiento</TabsTrigger>
        <TabsTrigger value="media">Multimedia</TabsTrigger>
        <TabsTrigger value="ui">Interfaz y acceso</TabsTrigger>
        <TabsTrigger value="versions">Versiones</TabsTrigger>
        <TabsTrigger value="test">Probar</TabsTrigger>
      </TabsList>

      <TabsContent value="model">
        <Card>
          <CardContent class="grid gap-4 pt-6 md:grid-cols-2">
            <Field>
              <FieldLabel for="primary">Modelo principal</FieldLabel>
              <ModelSelect id="primary" v-model="primaryModel" data-testid="agent-primary-model" />
              <FieldDescription>Debe soportar streaming y, si usas herramientas, llamadas a herramientas.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Respaldos (en orden)</FieldLabel>
              <div class="space-y-2">
                <div v-for="(_, i) in fallbacks" :key="i" class="flex gap-2">
                  <ModelSelect v-model="config.model.fallbackModelIds[i]!" />
                  <Button variant="ghost" size="icon" aria-label="Quitar respaldo" @click="config.model.fallbackModelIds.splice(i, 1)"><Trash2 class="size-4" /></Button>
                </div>
                <Button v-if="fallbacks.length < 3" variant="outline" size="sm" @click="config.model.fallbackModelIds.push('')"><Plus class="size-4" /> Agregar respaldo</Button>
              </div>
              <FieldDescription>Se usan si el principal falla antes de responder (red, cuota, modelo inexistente).</FieldDescription>
            </Field>
            <Field><FieldLabel for="temp">Temperatura</FieldLabel><Input id="temp" v-model="temperature" type="number" step="0.1" min="0" max="2" placeholder="predeterminada del modelo" /></Field>
            <Field><FieldLabel for="maxout">Tokens de salida máx.</FieldLabel><Input id="maxout" v-model.number="config.model.maxOutputTokens" type="number" min="64" max="32000" /></Field>
            <Field><FieldLabel for="steps">Pasos de herramientas máx.</FieldLabel><Input id="steps" v-model.number="config.limits.maxSteps" type="number" min="1" max="10" /></Field>
            <Field><FieldLabel for="hist">Mensajes de historial</FieldLabel><Input id="hist" v-model.number="config.limits.historyMessages" type="number" min="2" max="100" /></Field>
            <Field><FieldLabel for="maxin">Caracteres por mensaje</FieldLabel><Input id="maxin" v-model.number="config.limits.maxInputChars" type="number" min="100" max="100000" /></Field>
            <Field><FieldLabel for="timeout">Tiempo máximo (ms)</FieldLabel><Input id="timeout" v-model.number="config.limits.timeoutMs" type="number" min="5000" max="300000" step="1000" /></Field>
            <Field><FieldLabel for="retries">Reintentos por modelo</FieldLabel><Input id="retries" v-model.number="config.limits.retries" type="number" min="0" max="3" /></Field>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="instructions">
        <Card>
          <CardHeader><CardTitle class="text-base">Instrucciones del sistema</CardTitle><CardDescription>Las reglas de seguridad de la plataforma se agregan siempre después y no se pueden sobrescribir.</CardDescription></CardHeader>
          <CardContent class="space-y-3">
            <Textarea v-model="config.instructions" rows="14" class="font-mono text-sm" data-testid="agent-instructions" aria-label="Instrucciones" />
            <p class="text-muted-foreground text-xs">{{ config.instructions.length.toLocaleString('es-CL') }} / 20.000 caracteres</p>
            <Field><FieldLabel for="desc">Descripción interna</FieldLabel><Input id="desc" v-model="config.description" /></Field>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="tools">
        <Card>
          <CardHeader>
            <CardTitle class="text-base">Herramientas administrativas</CardTitle>
            <CardDescription>Se ejecutan con los permisos reales de quien conversa; las marcadas con confirmación solo preparan una propuesta que la persona aprueba en una tarjeta.</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-6 md:grid-cols-3">
            <fieldset v-for="(keys, group) in toolGroups" :key="group" class="space-y-2">
              <legend class="text-sm font-medium">{{ group }}</legend>
              <div v-for="k in keys" :key="k" class="flex items-start gap-2">
                <Checkbox :id="`tool-${k}`" :model-value="config.tools.admin.includes(k)" :data-testid="`tool-${k}`" @update:model-value="(v) => toggleTool(k, !!v)" />
                <Label :for="`tool-${k}`" class="flex flex-col items-start gap-0.5 text-sm font-normal">
                  <span>{{ ADMIN_TOOLS[k].label }} <Badge v-if="ADMIN_TOOLS[k].proposal" variant="outline" class="ml-1">confirmación</Badge></span>
                  <span class="text-muted-foreground font-mono text-xs">{{ ADMIN_TOOLS[k].permission }}</span>
                </Label>
              </div>
            </fieldset>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="knowledge">
        <Card>
          <CardHeader><CardTitle class="text-base">Conocimiento (RAG)</CardTitle><CardDescription>Solo se consultan las colecciones elegidas y únicamente los documentos que la persona puede ver.</CardDescription></CardHeader>
          <CardContent class="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel for="kmode">Modo</FieldLabel>
              <Select v-model="config.knowledge.mode">
                <SelectTrigger id="kmode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Desactivado</SelectItem>
                  <SelectItem value="tool">Herramienta (el modelo decide cuándo buscar)</SelectItem>
                  <SelectItem value="always">Siempre (buscar antes de responder)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field v-if="config.knowledge.mode !== 'off'" class="md:row-span-3"><FieldLabel>Colecciones</FieldLabel><CollectionsSelect v-model="config.knowledge.collectionIds" /></Field>
            <template v-if="config.knowledge.mode !== 'off'">
              <div class="grid grid-cols-2 gap-3">
                <Field><FieldLabel for="topk">Fragmentos (top K)</FieldLabel><Input id="topk" v-model.number="config.knowledge.topK" type="number" min="1" max="20" /></Field>
                <Field><FieldLabel for="minscore">Puntaje mínimo</FieldLabel><Input id="minscore" v-model.number="config.knowledge.minScore" type="number" min="0" max="1" step="0.05" /></Field>
              </div>
              <div class="flex items-center gap-2"><Switch id="cite" v-model="config.knowledge.requireCitations" /><Label for="cite">Exigir citas</Label></div>
              <div class="flex items-center gap-2"><Switch id="abstain" v-model="config.knowledge.abstainWithoutContext" /><Label for="abstain">Abstenerse sin contexto suficiente</Label></div>
            </template>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="media">
        <Card>
          <CardContent class="grid gap-6 pt-6 md:grid-cols-2">
            <div class="space-y-3">
              <div class="flex items-center gap-2"><Switch id="att" v-model="config.media.attachments" data-testid="agent-attachments" /><Label for="att">Permitir archivos adjuntos</Label></div>
              <template v-if="config.media.attachments">
                <div class="flex flex-wrap gap-4">
                  <div v-for="t in ['image', 'pdf', 'text'] as const" :key="t" class="flex items-center gap-2">
                    <Checkbox :id="`type-${t}`" :model-value="config.media.allowedTypes.includes(t)" @update:model-value="(v) => toggleType(t, !!v)" /><Label :for="`type-${t}`" class="font-normal">{{ { image: 'Imágenes', pdf: 'PDF', text: 'Texto' }[t] }}</Label>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <Field><FieldLabel for="maxfiles">Archivos por mensaje</FieldLabel><Input id="maxfiles" v-model.number="config.media.maxFiles" type="number" min="1" max="10" /></Field>
                  <Field><FieldLabel for="maxmb">Tamaño máx. (MB)</FieldLabel><Input id="maxmb" v-model.number="maxFileMb" type="number" min="1" max="50" /></Field>
                </div>
                <p class="text-muted-foreground text-xs">Los archivos se validan por su contenido y el modelo debe soportar el tipo (ver validación).</p>
              </template>
            </div>
            <div class="space-y-3">
              <div class="flex items-center gap-2"><Switch id="mic" v-model="config.media.audioInput" data-testid="agent-audio" /><Label for="mic">Dictado por micrófono</Label></div>
              <template v-if="config.media.audioInput">
                <Field><FieldLabel for="tmodel">Modelo de transcripción</FieldLabel><ModelSelect id="tmodel" v-model="transcriptionModel" fn="transcription" /></Field>
                <div class="grid grid-cols-2 gap-3">
                  <Field><FieldLabel for="lang">Idioma</FieldLabel><Input id="lang" :model-value="config.media.language ?? ''" placeholder="es" @update:model-value="(v) => (config.media.language = String(v) || null)" /></Field>
                  <Field><FieldLabel for="maxsec">Duración máx. (s)</FieldLabel><Input id="maxsec" v-model.number="config.media.maxAudioSeconds" type="number" min="5" max="900" /></Field>
                </div>
                <p class="text-muted-foreground text-xs">La transcripción vuelve al campo de texto para revisión; la grabación no se almacena.</p>
              </template>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="ui">
        <Card>
          <CardContent class="grid gap-4 pt-6 md:grid-cols-2">
            <Field><FieldLabel for="title">Título</FieldLabel><Input id="title" v-model="config.ui.title" /></Field>
            <Field><FieldLabel for="ph">Texto de ayuda del campo</FieldLabel><Input id="ph" v-model="config.ui.placeholder" /></Field>
            <Field class="md:col-span-2"><FieldLabel for="greet">Saludo</FieldLabel><Textarea id="greet" v-model="config.ui.greeting" rows="2" /></Field>
            <Field class="md:col-span-2">
              <FieldLabel>Sugerencias</FieldLabel>
              <div class="space-y-2">
                <div v-for="(_, i) in config.ui.suggestions" :key="i" class="flex gap-2">
                  <Input v-model="config.ui.suggestions[i]!" :aria-label="`Sugerencia ${i + 1}`" />
                  <Button variant="ghost" size="icon" aria-label="Quitar sugerencia" @click="config.ui.suggestions.splice(i, 1)"><Trash2 class="size-4" /></Button>
                </div>
                <Button v-if="config.ui.suggestions.length < 6" variant="outline" size="sm" @click="config.ui.suggestions.push('')"><Plus class="size-4" /> Agregar sugerencia</Button>
              </div>
            </Field>
            <div class="flex items-center gap-2"><Switch id="details" v-model="config.ui.showDetailsToAdmins" /><Label for="details">Mostrar modelo, tokens y costo a quienes ven consumo</Label></div>
            <Field>
              <FieldLabel for="perm">Permiso requerido para usarlo</FieldLabel>
              <Select v-model="config.access.requiredPermission">
                <SelectTrigger id="perm"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem v-for="k in PERMISSION_KEYS" :key="k" :value="k">{{ k }}</SelectItem></SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="versions">
        <Card>
          <CardContent class="overflow-x-auto pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Versión</TableHead><TableHead>Estado</TableHead><TableHead>Notas</TableHead><TableHead>Autor</TableHead><TableHead>Fecha</TableHead><TableHead class="sr-only">Acciones</TableHead></TableRow></TableHeader>
              <TableBody>
                <TableRow v-for="v in agent.versions" :key="v.id" :data-testid="`version-${v.version}`">
                  <TableCell class="font-medium">v{{ v.version }}</TableCell>
                  <TableCell><StatusBadge :status="v.status" /></TableCell>
                  <TableCell class="max-w-64 truncate">{{ v.notes ?? '—' }}</TableCell>
                  <TableCell class="text-xs">{{ v.createdBy ?? 'sistema' }}</TableCell>
                  <TableCell class="text-xs">{{ formatDate(v.publishedAt ?? v.updatedAt) }}</TableCell>
                  <TableCell class="text-right whitespace-nowrap">
                    <Button v-if="published && v.id !== published.id" variant="ghost" size="sm" @click="diffOf = v">Diferencias</Button>
                    <Button v-if="v.status === 'archived'" variant="outline" size="sm" :data-testid="`rollback-${v.version}`" @click="rollback(v)">Restaurar</Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="test">
        <Card>
          <CardHeader><CardTitle class="text-base">Probar</CardTitle><CardDescription>Usa tus permisos reales; las herramientas sensibles solo crean propuestas. El consumo se registra en el libro.</CardDescription></CardHeader>
          <CardContent class="space-y-4">
            <div class="flex flex-col gap-2 sm:flex-row">
              <Select v-model="testVersion">
                <SelectTrigger class="sm:w-56" aria-label="Versión a probar"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem v-for="v in agent.versions.filter((x) => x.status !== 'archived')" :key="v.id" :value="v.id">v{{ v.version }} ({{ v.status === 'draft' ? 'borrador' : 'publicada' }})</SelectItem></SelectContent>
              </Select>
              <Input v-model="testMessage" placeholder="Mensaje de prueba" data-testid="agent-test-message" @keydown.enter="runTest" />
              <Button :disabled="testing || !testMessage.trim() || !testVersion || (dirty && testVersion === draft?.id)" data-testid="agent-test-run" @click="runTest">Probar</Button>
            </div>
            <p v-if="dirty && testVersion === draft?.id" class="text-muted-foreground text-xs">Guarda el borrador para probar los cambios.</p>
            <Alert v-if="testError" variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{{ testError }}</AlertDescription></Alert>
            <div v-if="testResult" class="space-y-3" data-testid="agent-test-result">
              <p class="bg-muted/60 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">{{ testResult.text || '(sin texto)' }}</p>
              <div v-for="(t, i) in testResult.toolCalls" :key="i" class="rounded-md border p-2 text-xs">
                <p class="font-medium">{{ t.name }}</p>
                <pre class="text-muted-foreground mt-1 max-h-40 overflow-auto">{{ JSON.stringify(t.output, null, 2) }}</pre>
              </div>
              <p class="text-muted-foreground text-xs tabular-nums">
                {{ testResult.modelId }} · {{ testResult.inputTokens ?? '?' }}↑ {{ testResult.outputTokens ?? '?' }}↓ · {{ testResult.latencyMs }} ms ·
                {{ testResult.costStatus === 'unknown' ? 'costo desconocido' : formatUsd(testResult.costUsd) }}
              </p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>

    <Dialog :open="!!diffOf" @update:open="(v: boolean) => !v && (diffOf = null)">
      <DialogContent class="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>v{{ diffOf?.version }} frente a la versión publicada</DialogTitle></DialogHeader>
        <JsonDiff v-if="diff" :before="diff.before" :after="diff.after" />
      </DialogContent>
    </Dialog>
  </div>
</template>
