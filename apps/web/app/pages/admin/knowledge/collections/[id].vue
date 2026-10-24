<script setup lang="ts">
import {
  ragCollectionsDelete,
  ragCollectionsGet,
  ragCollectionsReindex,
  ragCollectionsUpdate,
  ragDocumentsDelete,
  ragDocumentsGet,
  ragDocumentsList,
  ragDocumentsReprocess,
  ragDocumentsUpload,
  ragJobsList,
  ragProfilesList,
  ragSourcesCreate,
  ragSourcesDelete,
  ragSourcesList,
  ragSourcesSync,
  ragSourcesUpdate,
  type DocumentDetail,
  type RagDocument,
  type Source,
} from '@starter/api-client';
import { ArrowLeft, FileUp, Globe, Map as MapIcon, MoreHorizontal, Plus, RefreshCw, Type } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Textarea } from '#ui/components/ui/textarea';
import { Badge } from '#ui/components/ui/badge';
import { Card, CardContent } from '#ui/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import { formatBytes, formatNumber, formatUsd } from '#ui/lib/format';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import FileDropzone from '#ui/components/common/FileDropzone.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';
import JobProgress from '~/components/knowledge/JobProgress.vue';
import RolesAclInput from '~/components/knowledge/RolesAclInput.vue';
import DocumentChunksSheet from '~/components/knowledge/DocumentChunksSheet.vue';

definePageMeta({ permission: ['rag.collections.read', 'rag.collections.manage'], feature: 'rag', breadcrumb: 'Detalle' });
const api = useApi();
const notify = useNotify();
const route = useRoute();
const can = useCan();
const { confirm } = useConfirm();
const id = computed(() => String(route.params.id));
const { data: collection, refresh, problem } = await useApiData(`rag-collection-${id.value}`, () => unwrap(ragCollectionsGet({ client: api, path: { id: id.value } })), { fatal: [404] });
useHead({ title: () => collection.value?.name ?? 'Colección' });
const canIngest = computed(() => can('rag.sources.manage') && collection.value?.status === 'active');

// ── sources ─────────────────────────────────────────────────────────────
const { data: sources, refresh: refreshSources } = await useAsyncData(`rag-sources-${id.value}`, () => unwrap(ragSourcesList({ client: api, path: { id: id.value } })));
const sourceOpen = ref(false);
const sourceKind = ref<'url' | 'sitemap' | 'text'>('url');
const src = reactive({ name: '', url: '', maxUrls: 200, include: '', exclude: '', schedule: '', title: '', text: '' });
const sourceError = ref<string | null>(null);
async function createSource() {
  sourceError.value = null;
  const common = { name: src.name || (sourceKind.value === 'text' ? src.title : src.url), acl: { roles: [], users: [] } };
  const body =
    sourceKind.value === 'url'
      ? { ...common, kind: 'url' as const, url: src.url, schedule: src.schedule || null }
      : sourceKind.value === 'sitemap'
        ? { ...common, kind: 'sitemap' as const, url: src.url, maxUrls: src.maxUrls, include: src.include || null, exclude: src.exclude || null, schedule: src.schedule || null }
        : { ...common, kind: 'text' as const, title: src.title, text: src.text };
  try {
    await ragSourcesCreate({ client: api, path: { id: id.value }, body });
    toast.success('Fuente agregada; la sincronización está en cola');
    sourceOpen.value = false;
    Object.assign(src, { name: '', url: '', include: '', exclude: '', schedule: '', title: '', text: '' });
    await Promise.all([refreshSources(), refreshJobs()]);
  } catch (err) {
    sourceError.value = apiError(err).message;
  }
}
async function syncSource(s: Source) {
  try {
    await ragSourcesSync({ client: api, path: { id: s.id } });
    toast.success('Sincronización en cola');
    await refreshJobs();
  } catch (err) {
    notify.error(err);
  }
}
async function togglePause(s: Source) {
  await ragSourcesUpdate({ client: api, path: { id: s.id }, body: { status: s.status === 'paused' ? 'active' : 'paused' } }).catch((err) => notify.error(err));
  await refreshSources();
}
async function removeSource(s: Source) {
  if (!(await confirm({ title: `¿Eliminar la fuente «${s.name}»?`, description: 'Sus documentos se eliminan del índice y del almacenamiento mediante trabajos durables.', confirmLabel: 'Eliminar', destructive: true }))) return;
  await ragSourcesDelete({ client: api, path: { id: s.id } }).catch((err) => notify.error(err));
  await Promise.all([refreshSources(), refreshJobs()]);
}
const SOURCE_ICON = { url: Globe, sitemap: MapIcon, text: Type, upload: FileUp } as const;

// ── documents ───────────────────────────────────────────────────────────
const docQuery = reactive({ page: 1, status: 'all', search: '' });
const { data: documents, refresh: refreshDocs } = await useAsyncData(
  `rag-docs-${id.value}`,
  () => unwrap(ragDocumentsList({ client: api, query: { collectionId: id.value, page: docQuery.page, pageSize: 20, status: docQuery.status === 'all' ? undefined : (docQuery.status as 'indexed'), search: docQuery.search || undefined } })),
  { watch: [docQuery] },
);
const uploading = ref(false);
const uploadRoles = ref<string[]>([]);
async function onFiles(files: File[]) {
  uploading.value = true;
  try {
    for (const f of files) {
      try {
        await ragDocumentsUpload({ client: api, path: { id: id.value }, body: { file: f, aclRoles: uploadRoles.value.join(',') } });
        toast.success(`«${f.name}» en cola para indexar`);
      } catch (err) {
        notify.error(err, { context: `«${f.name}»` });
      }
    }
    await refreshJobs();
  } finally {
    uploading.value = false;
  }
}
const viewing = ref<DocumentDetail | null>(null);
async function openDoc(d: RagDocument) {
  try {
    viewing.value = await unwrap(ragDocumentsGet({ client: api, path: { id: id.value, documentId: d.id } }));
  } catch (err) {
    notify.error(err);
  }
}
async function deleteDoc(d: RagDocument) {
  if (!(await confirm({ title: `¿Eliminar «${d.title ?? d.externalId}»?`, description: 'Se eliminan sus fragmentos, vectores y el archivo almacenado.', confirmLabel: 'Eliminar', destructive: true }))) return;
  try {
    await ragDocumentsDelete({ client: api, path: { id: id.value, documentId: d.id } });
    toast.success('Eliminación en cola');
    await refreshJobs();
  } catch (err) {
    notify.error(err);
  }
}
async function reprocess(d: RagDocument) {
  try {
    await ragDocumentsReprocess({ client: api, path: { id: id.value, documentId: d.id } });
    toast.success('Reprocesamiento en cola');
    await refreshJobs();
  } catch (err) {
    notify.error(err);
  }
}

// ── jobs (auto refresh while active) ────────────────────────────────────
const { data: jobs, refresh: refreshJobs } = await useAsyncData(`rag-jobs-${id.value}`, () =>
  can('rag.jobs.manage') ? unwrap(ragJobsList({ client: api, query: { collectionId: id.value, page: 1, pageSize: 20 } })) : Promise.resolve(null),
);
const active = computed(() => (jobs.value?.items ?? []).some((j) => ['queued', 'running', 'retrying'].includes(j.status)));
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(async () => {
    if (!active.value) return;
    await refreshJobs();
    if (!active.value) await Promise.all([refreshDocs(), refresh(), refreshSources()]);
  }, 2000);
});
onBeforeUnmount(() => clearInterval(timer));

// ── settings ────────────────────────────────────────────────────────────
const settings = reactive({ name: '', description: '', visibility: 'organization' as 'organization' | 'restricted', aclRoles: [] as string[], size: 1200, overlap: 150, method: 'hybrid' as 'vector' | 'fulltext' | 'hybrid', topK: 6, minScore: 0, retentionDays: '' as string | number });
watch(
  collection,
  (c) => {
    if (!c) return;
    Object.assign(settings, { name: c.name, description: c.description ?? '', visibility: c.visibility, aclRoles: [...c.aclRoles], size: c.chunking.size, overlap: c.chunking.overlap, method: c.retrieval.method, topK: c.retrieval.topK, minScore: c.retrieval.minScore, retentionDays: c.retentionDays ?? '' });
  },
  { immediate: true },
);
async function saveSettings() {
  try {
    await ragCollectionsUpdate({
      client: api,
      path: { id: id.value },
      body: {
        name: settings.name,
        description: settings.description || null,
        visibility: settings.visibility,
        aclRoles: settings.aclRoles,
        chunking: { size: settings.size, overlap: settings.overlap },
        retrieval: { method: settings.method, topK: settings.topK, minScore: settings.minScore },
        retentionDays: settings.retentionDays === '' ? null : Number(settings.retentionDays),
      },
    });
    toast.success('Colección actualizada', { description: 'Los cambios de fragmentación aplican a documentos nuevos o al reindexar.' });
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}
const { data: profiles } = await useAsyncData('rag-profiles-min', () => (can('rag.collections.manage') ? unwrap(ragProfilesList({ client: api })) : Promise.resolve([])));
const reindexOpen = ref(false);
const reindexProfile = ref<string>('');
const reindexBudget = ref('');
async function reindex() {
  try {
    await ragCollectionsReindex({ client: api, path: { id: id.value }, body: { embeddingProfileId: reindexProfile.value || undefined, budgetUsd: reindexBudget.value || undefined } });
    toast.success('Reindexación en cola', { description: 'Las búsquedas siguen usando el índice actual hasta el cambio.' });
    reindexOpen.value = false;
    await Promise.all([refresh(), refreshJobs()]);
  } catch (err) {
    notify.error(err);
  }
}
async function removeCollection() {
  if (!collection.value) return;
  if (!(await confirm({ title: `¿Eliminar la colección «${collection.value.name}»?`, description: 'Se purgarán documentos, fragmentos, vectores y archivos. Los agentes que la usan dejarán de consultarla.', confirmLabel: 'Eliminar', destructive: true, typeToConfirm: collection.value.slug }))) return;
  try {
    await ragCollectionsDelete({ client: api, path: { id: id.value } });
    toast.success('Eliminación en curso');
    await navigateTo('/admin/knowledge/collections');
  } catch (err) {
    notify.error(err);
  }
}
</script>

<template>
  <LoadError v-if="problem" :error="problem" @retry="refresh()" />
  <div v-if="collection" class="space-y-6">
    <Button variant="ghost" size="sm" as-child class="-ml-2"><NuxtLink to="/admin/knowledge/collections"><ArrowLeft class="size-4" /> Colecciones</NuxtLink></Button>
    <PageHeader :title="collection.name" :description="`${collection.connection.name}${collection.profile ? ` · ${collection.profile.modelId} (${collection.profile.dimensions} dim.)` : ''} · ${collection.visibility === 'organization' ? 'toda la organización' : 'restringida'}`">
      <template #actions>
        <Badge v-if="collection.buildingIndexVersionId" variant="outline">reindexando…</Badge>
        <Button v-if="can('rag.collections.manage') && collection.connection.kind !== 'api'" variant="outline" data-testid="collection-reindex" @click="reindexOpen = true"><RefreshCw class="size-4" /> Reindexar</Button>
      </template>
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-4">
      <StatCard title="Documentos" :value="formatNumber(collection.stats.documents)" :hint="`${collection.stats.indexed} indexados · ${collection.stats.failed} con error`" />
      <StatCard title="Fragmentos" :value="formatNumber(collection.stats.chunks)" />
      <StatCard title="Tamaño" :value="formatBytes(collection.stats.bytes)" />
      <StatCard title="Fuentes" :value="formatNumber(collection.sources)" />
    </div>

    <Tabs default-value="documents">
      <TabsList>
        <TabsTrigger value="documents">Documentos</TabsTrigger>
        <TabsTrigger value="sources">Fuentes</TabsTrigger>
        <TabsTrigger v-if="can('rag.jobs.manage')" value="jobs">Trabajos <Badge v-if="active" variant="secondary" class="ml-1">activos</Badge></TabsTrigger>
        <TabsTrigger v-if="can('rag.collections.manage')" value="settings">Configuración</TabsTrigger>
      </TabsList>

      <TabsContent value="documents" class="space-y-4">
        <Card v-if="canIngest && collection.connection.kind !== 'api'">
          <CardContent class="space-y-3 pt-6">
            <FileDropzone accept=".pdf,.md,.markdown,.txt,.html,.htm,application/pdf,text/plain,text/markdown,text/html" multiple :disabled="uploading" label="Arrastra PDF, Markdown, HTML o texto" data-testid="rag-upload" @files="onFiles" />
            <details class="text-sm">
              <summary class="text-muted-foreground cursor-pointer">Restringir los archivos subidos a ciertos roles</summary>
              <div class="pt-2"><RolesAclInput v-model="uploadRoles" /></div>
            </details>
          </CardContent>
        </Card>
        <div class="flex flex-wrap gap-2">
          <Input v-model="docQuery.search" placeholder="Buscar por título o URL" class="w-full sm:w-64" aria-label="Buscar documentos" />
          <Select v-model="docQuery.status">
            <SelectTrigger class="w-40" aria-label="Estado"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todo estado</SelectItem><SelectItem value="indexed">Indexado</SelectItem><SelectItem value="processing">Procesando</SelectItem><SelectItem value="pending">Pendiente</SelectItem><SelectItem value="failed">Con error</SelectItem></SelectContent>
          </Select>
        </div>
        <div class="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Documento</TableHead><TableHead>Estado</TableHead><TableHead>Fragmentos</TableHead><TableHead>Tamaño</TableHead><TableHead>Actualizado</TableHead><TableHead class="sr-only">Acciones</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow v-for="d in documents?.items" :key="d.id" :data-testid="`doc-${d.title}`">
                <TableCell>
                  <button type="button" class="text-left font-medium underline-offset-4 hover:underline" @click="openDoc(d)">{{ d.title ?? d.externalId }}</button>
                  <div class="text-muted-foreground max-w-80 truncate text-xs">{{ d.sourceUrl ?? d.mediaType }}<template v-if="d.aclRoles.length"> · solo {{ d.aclRoles.join(', ') }}</template></div>
                  <p v-if="d.error" class="text-destructive text-xs">{{ d.error }}</p>
                </TableCell>
                <TableCell><StatusBadge :status="d.status" data-testid="doc-status" /></TableCell>
                <TableCell class="tabular-nums">{{ d.chunkCount }}</TableCell>
                <TableCell class="tabular-nums">{{ formatBytes(d.bytes) }}</TableCell>
                <TableCell><RelativeTime :value="d.updatedAt" /></TableCell>
                <TableCell class="text-right">
                  <DropdownMenu v-if="can('rag.sources.manage') || can('rag.documents.delete')">
                    <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" :aria-label="`Acciones de ${d.title}`"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem @click="openDoc(d)">Ver fragmentos</DropdownMenuItem>
                      <DropdownMenuItem v-if="can('rag.sources.manage')" @click="reprocess(d)">Volver a procesar</DropdownMenuItem>
                      <DropdownMenuSeparator v-if="can('rag.documents.delete')" />
                      <DropdownMenuItem v-if="can('rag.documents.delete')" class="text-destructive" @click="deleteDoc(d)">Eliminar</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
              <TableRow v-if="!documents?.items.length"><TableCell colspan="6" class="text-muted-foreground text-center">{{ collection.connection.kind === 'api' ? 'Los documentos viven en el servicio externo.' : 'Sin documentos todavía.' }}</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="sources" class="space-y-4">
        <div class="flex justify-end"><Button v-if="canIngest" data-testid="source-new" @click="sourceOpen = true"><Plus class="size-4" /> Agregar fuente</Button></div>
        <div class="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Fuente</TableHead><TableHead>Estado</TableHead><TableHead>Programación</TableHead><TableHead>Última sincronización</TableHead><TableHead class="sr-only">Acciones</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow v-for="s in sources" :key="s.id">
                <TableCell>
                  <div class="flex items-center gap-2 font-medium"><component :is="SOURCE_ICON[s.kind]" class="text-muted-foreground size-4" aria-hidden="true" />{{ s.name }}</div>
                  <div class="text-muted-foreground max-w-96 truncate text-xs">{{ (s.config as Record<string, unknown>).url ?? '' }}</div>
                  <p v-if="s.lastError" class="text-destructive text-xs">{{ s.lastError }}</p>
                </TableCell>
                <TableCell><StatusBadge :status="s.status" /></TableCell>
                <TableCell class="font-mono text-xs">{{ s.schedule ?? 'manual' }}<div v-if="s.nextSyncAt" class="text-muted-foreground font-sans">próxima <RelativeTime :value="s.nextSyncAt" /></div></TableCell>
                <TableCell class="text-xs"><RelativeTime v-if="s.lastSyncAt" :value="s.lastSyncAt" /><span v-else>—</span><div v-if="s.stats.discovered !== undefined" class="text-muted-foreground">{{ s.stats.discovered }} descubiertos · {{ s.stats.added }} nuevos · {{ s.stats.removed }} quitados</div></TableCell>
                <TableCell class="text-right whitespace-nowrap">
                  <template v-if="can('rag.sources.manage')">
                    <Button v-if="s.kind !== 'upload'" variant="ghost" size="sm" @click="syncSource(s)">Sincronizar</Button>
                    <Button v-if="s.kind !== 'upload' && s.schedule" variant="ghost" size="sm" @click="togglePause(s)">{{ s.status === 'paused' ? 'Reanudar' : 'Pausar' }}</Button>
                    <Button variant="ghost" size="sm" class="text-destructive" @click="removeSource(s)">Eliminar</Button>
                  </template>
                </TableCell>
              </TableRow>
              <TableRow v-if="!sources?.length"><TableCell colspan="5" class="text-muted-foreground text-center">Sin fuentes. Sube archivos o agrega una URL, un sitemap o un texto.</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="jobs">
        <div class="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Trabajo</TableHead><TableHead>Progreso</TableHead><TableHead>Intentos</TableHead><TableHead>Costo</TableHead><TableHead>Creado</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow v-for="j in jobs?.items" :key="j.id" :data-testid="`job-${j.kind}`">
                <TableCell class="text-sm">{{ jobKindLabel(j.kind) }}</TableCell>
                <TableCell><JobProgress :job="j" /></TableCell>
                <TableCell class="tabular-nums">{{ j.attempts }}/{{ j.maxAttempts }}</TableCell>
                <TableCell class="tabular-nums">{{ formatUsd(j.costUsd) }}<span v-if="j.units.unpriced_calls" class="text-amber-600 dark:text-amber-400"> + desconocido</span></TableCell>
                <TableCell><RelativeTime :value="j.createdAt" /></TableCell>
              </TableRow>
              <TableRow v-if="!jobs?.items.length"><TableCell colspan="5" class="text-muted-foreground text-center">Sin trabajos.</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="settings">
        <Card>
          <CardContent class="grid gap-4 pt-6 md:grid-cols-2">
            <Field><FieldLabel for="cs-name">Nombre</FieldLabel><Input id="cs-name" v-model="settings.name" /></Field>
            <Field><FieldLabel for="cs-ret">Retención (días)</FieldLabel><Input id="cs-ret" v-model="settings.retentionDays" type="number" min="1" placeholder="sin límite" /><FieldDescription>Documentos sin actualizar por más tiempo se eliminan automáticamente.</FieldDescription></Field>
            <Field class="md:col-span-2"><FieldLabel for="cs-desc">Descripción</FieldLabel><Textarea id="cs-desc" v-model="settings.description" rows="2" /></Field>
            <Field>
              <FieldLabel for="cs-vis">Acceso</FieldLabel>
              <Select v-model="settings.visibility">
                <SelectTrigger id="cs-vis"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="organization">Toda la organización (con permiso de lectura)</SelectItem><SelectItem value="restricted">Solo roles elegidos</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field v-if="settings.visibility === 'restricted'"><FieldLabel>Roles con acceso</FieldLabel><RolesAclInput v-model="settings.aclRoles" /></Field>
            <div class="grid grid-cols-2 gap-3">
              <Field><FieldLabel for="cs-size">Fragmento (caracteres)</FieldLabel><Input id="cs-size" v-model.number="settings.size" type="number" min="200" max="8000" /></Field>
              <Field><FieldLabel for="cs-ov">Solapamiento</FieldLabel><Input id="cs-ov" v-model.number="settings.overlap" type="number" min="0" max="2000" /></Field>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel for="cs-method">Búsqueda</FieldLabel>
                <Select v-model="settings.method">
                  <SelectTrigger id="cs-method"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="hybrid">Híbrida</SelectItem><SelectItem value="vector">Vectorial</SelectItem><SelectItem value="fulltext">Texto</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field><FieldLabel for="cs-k">Top K</FieldLabel><Input id="cs-k" v-model.number="settings.topK" type="number" min="1" max="50" /></Field>
              <Field><FieldLabel for="cs-min">Puntaje mín.</FieldLabel><Input id="cs-min" v-model.number="settings.minScore" type="number" min="0" max="1" step="0.05" /></Field>
            </div>
            <div class="flex items-center justify-between gap-2 md:col-span-2">
              <Button variant="destructive" data-testid="collection-delete" @click="removeCollection">Eliminar colección</Button>
              <Button data-testid="collection-save" @click="saveSettings">Guardar cambios</Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>

    <Dialog v-model:open="sourceOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader><DialogTitle>Agregar fuente</DialogTitle><DialogDescription>Las URL se descargan desde el servidor con protección contra redes privadas, tamaño máximo y tiempo límite.</DialogDescription></DialogHeader>
        <form id="src-form" class="space-y-4" @submit.prevent="createSource">
          <Select v-model="sourceKind">
            <SelectTrigger aria-label="Tipo de fuente" data-testid="source-kind"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="url">Página web (URL)</SelectItem><SelectItem value="sitemap">Sitio completo (sitemap.xml)</SelectItem><SelectItem value="text">Texto</SelectItem></SelectContent>
          </Select>
          <template v-if="sourceKind !== 'text'">
            <Field><FieldLabel for="src-url">URL</FieldLabel><Input id="src-url" v-model="src.url" type="url" required :placeholder="sourceKind === 'sitemap' ? 'https://example.com/sitemap.xml' : 'https://example.com/pagina'" /></Field>
            <template v-if="sourceKind === 'sitemap'">
              <div class="grid grid-cols-3 gap-2">
                <Field><FieldLabel for="src-max">Máx. URLs</FieldLabel><Input id="src-max" v-model.number="src.maxUrls" type="number" min="1" max="5000" /></Field>
                <Field><FieldLabel for="src-inc">Incluir (regex)</FieldLabel><Input id="src-inc" v-model="src.include" placeholder="/docs/" /></Field>
                <Field><FieldLabel for="src-exc">Excluir (regex)</FieldLabel><Input id="src-exc" v-model="src.exclude" /></Field>
              </div>
            </template>
            <Field><FieldLabel for="src-cron">Programación (cron, UTC)</FieldLabel><Input id="src-cron" v-model="src.schedule" placeholder="0 6 * * 1 (lunes 06:00)" /><FieldDescription>Vacío = solo manual.</FieldDescription></Field>
          </template>
          <template v-else>
            <Field><FieldLabel for="src-title">Título</FieldLabel><Input id="src-title" v-model="src.title" required data-testid="source-title" /></Field>
            <Field><FieldLabel for="src-text">Contenido (Markdown)</FieldLabel><Textarea id="src-text" v-model="src.text" rows="8" required data-testid="source-text" /></Field>
          </template>
          <Field><FieldLabel for="src-name">Nombre (opcional)</FieldLabel><Input id="src-name" v-model="src.name" /></Field>
          <Alert v-if="sourceError" variant="destructive"><AlertDescription>{{ sourceError }}</AlertDescription></Alert>
        </form>
        <DialogFooter><Button type="submit" form="src-form" data-testid="source-submit">Agregar y sincronizar</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="reindexOpen">
      <DialogContent>
        <DialogHeader><DialogTitle>Reindexar colección</DialogTitle><DialogDescription>Se construye un índice nuevo en segundo plano; al terminar se cambia de forma atómica y el anterior se descarta.</DialogDescription></DialogHeader>
        <div class="space-y-4">
          <Field>
            <FieldLabel for="ri-profile">Perfil de embeddings</FieldLabel>
            <Select v-model="reindexProfile">
              <SelectTrigger id="ri-profile"><SelectValue :placeholder="`Mantener ${collection?.profile?.name ?? ''}`" /></SelectTrigger>
              <SelectContent><SelectItem v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }} · {{ p.modelId }} ({{ p.dimensions }})</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel for="ri-budget">Presupuesto máximo (USD, opcional)</FieldLabel><Input id="ri-budget" v-model="reindexBudget" inputmode="decimal" /></Field>
        </div>
        <DialogFooter><Button data-testid="reindex-submit" @click="reindex">Reindexar</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <DocumentChunksSheet v-model="viewing" />
  </div>
</template>
