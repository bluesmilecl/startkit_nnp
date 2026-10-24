<script setup lang="ts">
import {
  ragConnectionsActivate,
  ragConnectionsCreate,
  ragConnectionsDelete,
  ragConnectionsDiagnose,
  ragConnectionsList,
  ragProfilesCreate,
  ragProfilesDelete,
  ragProfilesList,
  type RagConnection,
} from '@starter/api-client';
import { CreateEmbeddingProfileInput, CreateRagConnectionInput } from '@starter/contracts';
import { CircleAlert, CircleCheck, Database, MoreHorizontal, Plus, TriangleAlert } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Badge } from '#ui/components/ui/badge';
import { Switch } from '#ui/components/ui/switch';
import { Label } from '#ui/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '#ui/components/ui/alert';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';
import ModelSelect from '~/components/shared/ModelSelect.vue';

definePageMeta({ permission: 'rag.collections.manage', feature: 'rag' });
useHead({ title: 'Conexiones de conocimiento' });
const api = useApi();
const notify = useNotify();
const { confirm } = useConfirm();
const { data: connections, refresh } = await useAsyncData('rag-connections', () => unwrap(ragConnectionsList({ client: api })));
const { data: profiles, refresh: refreshProfiles } = await useAsyncData('rag-profiles', () => unwrap(ragProfilesList({ client: api })));

const KIND: Record<string, string> = { internal: 'Interna (misma base de datos)', postgres: 'PostgreSQL externo', api: 'API de recuperación externa' };
const CAPS: [string, string][] = [
  ['vector', 'Vectorial'],
  ['fullText', 'Texto completo'],
  ['hybrid', 'Híbrida'],
  ['ingest', 'Ingesta'],
  ['delete', 'Eliminación'],
  ['reindex', 'Reindexación'],
  ['acl', 'Permisos por documento'],
  ['browse', 'Explorar documentos'],
];

const busy = ref<string | null>(null);
async function run(c: RagConnection, action: 'diagnose' | 'activate') {
  busy.value = c.id;
  try {
    const r = await unwrap(action === 'diagnose' ? ragConnectionsDiagnose({ client: api, path: { id: c.id } }) : ragConnectionsActivate({ client: api, path: { id: c.id } }));
    if (r.status === 'ready') toast.success(`${c.name}: lista`);
    else toast.warning(`${c.name}: revisa el diagnóstico`);
    await refresh();
  } catch (err) {
    notify.error(err);
  } finally {
    busy.value = null;
  }
}
async function remove(c: RagConnection) {
  if (!(await confirm({ title: `¿Eliminar ${c.name}?`, description: 'Solo es posible si no tiene colecciones. Los datos del almacén externo no se borran.', confirmLabel: 'Eliminar', destructive: true }))) return;
  try {
    await ragConnectionsDelete({ client: api, path: { id: c.id } });
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}

const open = ref(false);
const form = useZodForm(CreateRagConnectionInput, { name: '', kind: 'internal', schema: 'rag', tls: 'disable', timeoutMs: 10_000, access: 'read-write', managed: true });
const submit = form.handleSubmit(async (values) => {
  const c = await unwrap(ragConnectionsCreate({ client: api, body: values }));
  open.value = false;
  form.reset();
  await refresh();
  await run(c, 'diagnose');
});

const profileOpen = ref(false);
const pform = useZodForm(CreateEmbeddingProfileInput, { key: '', name: '', modelCatalogId: '', metric: 'cosine' });
const pmodel = computed({ get: () => pform.values.modelCatalogId || null, set: (v: string | null) => (pform.values.modelCatalogId = v ?? '') });
const psubmit = pform.handleSubmit(async (values) => {
  await ragProfilesCreate({ client: api, body: values });
  toast.success('Perfil creado');
  profileOpen.value = false;
  pform.reset();
  await refreshProfiles();
});
async function removeProfile(id: string) {
  try {
    await ragProfilesDelete({ client: api, path: { id } });
    await refreshProfiles();
  } catch (err) {
    notify.error(err);
  }
}
</script>

<template>
  <PageHeader title="Conexiones de conocimiento" description="Dónde se guarda y consulta el conocimiento: la base de datos de la aplicación con pgvector, un PostgreSQL externo o una API de recuperación.">
    <template #actions><Button data-testid="rag-connection-new" @click="open = true"><Plus class="size-4" /> Nueva conexión</Button></template>
  </PageHeader>

  <EmptyState v-if="connections && !connections.length" title="RAG desactivado" description="Sin conexiones el asistente no usa conocimiento. Crea una conexión interna para empezar con pgvector en la base de datos de la aplicación." :icon="Database" />

  <div class="grid gap-4 xl:grid-cols-2">
    <Card v-for="c in connections" :key="c.id" :data-testid="`rag-connection-${c.name}`">
      <CardHeader>
        <div class="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{{ c.name }}</CardTitle>
            <CardDescription>{{ KIND[c.kind] }}<template v-if="c.schema"> · esquema {{ c.schema }}</template><template v-if="c.baseUrl"> · {{ c.baseUrl }}</template></CardDescription>
          </div>
          <div class="flex items-center gap-1">
            <StatusBadge :status="c.status" data-testid="rag-connection-status" />
            <DropdownMenu>
              <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" :aria-label="`Acciones de ${c.name}`"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuItem class="text-destructive" @click="remove(c)">Eliminar</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-3 text-sm">
        <p class="text-muted-foreground text-xs">
          {{ c.collections }} colección(es) · credencial: {{ c.credentialSource === 'application' ? 'la de la aplicación' : (c.credentialHint ?? 'ninguna') }} · {{ c.access === 'read-only' ? 'solo lectura' : 'lectura y escritura' }}
          <template v-if="c.diagnosedAt"> · diagnosticada <RelativeTime :value="c.diagnosedAt" /></template>
        </p>
        <ul v-if="c.diagnostic" class="space-y-1" data-testid="rag-diagnostic">
          <li v-for="ch in c.diagnostic.checks" :key="ch.key" class="flex items-start gap-2" :data-check="ch.key" :data-status="ch.status">
            <CircleCheck v-if="ch.status === 'ok'" class="mt-0.5 size-4 shrink-0 text-green-600" aria-label="Correcto" />
            <TriangleAlert v-else-if="ch.status === 'warn'" class="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Advertencia" />
            <CircleAlert v-else class="text-destructive mt-0.5 size-4 shrink-0" aria-label="Error" />
            <span><span class="font-medium">{{ ch.label }}:</span> {{ ch.detail }}</span>
          </li>
        </ul>
        <Alert v-if="c.diagnostic?.manualSteps.length">
          <AlertTitle>Pasos manuales</AlertTitle>
          <AlertDescription><ol class="list-decimal space-y-1 pl-4"><li v-for="s in c.diagnostic.manualSteps" :key="s" class="font-mono text-xs break-all">{{ s }}</li></ol></AlertDescription>
        </Alert>
        <div v-if="c.capabilities" class="flex flex-wrap gap-1" aria-label="Capacidades">
          <Badge v-for="[k, l] in CAPS" :key="k" :variant="(c.capabilities as Record<string, boolean>)[k] ? 'secondary' : 'outline'" :class="{ 'text-muted-foreground line-through': !(c.capabilities as Record<string, boolean>)[k] }">{{ l }}</Badge>
        </div>
      </CardContent>
      <CardFooter class="gap-2">
        <Button variant="outline" size="sm" :disabled="busy === c.id" data-testid="rag-diagnose" @click="run(c, 'diagnose')">Diagnosticar</Button>
        <Button v-if="c.status !== 'ready'" size="sm" :disabled="busy === c.id" data-testid="rag-activate" @click="run(c, 'activate')">{{ c.kind === 'api' ? 'Verificar contrato' : 'Activar' }}</Button>
      </CardFooter>
    </Card>
  </div>

  <Card>
    <CardHeader class="flex flex-row items-center justify-between gap-2">
      <div><CardTitle class="text-base">Perfiles de embeddings</CardTitle><CardDescription>Modelo, dimensiones y métrica del espacio vectorial. Cambiar de perfil en una colección requiere reindexar.</CardDescription></div>
      <Button size="sm" variant="outline" data-testid="rag-profile-new" @click="profileOpen = true"><Plus class="size-4" /> Nuevo perfil</Button>
    </CardHeader>
    <CardContent class="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Perfil</TableHead><TableHead>Modelo</TableHead><TableHead>Dimensiones</TableHead><TableHead>Métrica</TableHead><TableHead>Índice</TableHead><TableHead>Colecciones</TableHead><TableHead class="sr-only">Acciones</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow v-for="p in profiles" :key="p.id">
            <TableCell class="font-medium">{{ p.name }} <span class="text-muted-foreground text-xs">({{ p.key }})</span></TableCell>
            <TableCell class="text-xs">{{ p.provider }} · {{ p.modelId }}</TableCell>
            <TableCell class="tabular-nums">{{ p.dimensions }}</TableCell>
            <TableCell>{{ p.metric }}</TableCell>
            <TableCell>{{ p.indexType === 'hnsw' ? 'HNSW' : p.indexType === 'hnsw_halfvec' ? 'HNSW halfvec' : 'búsqueda exacta' }}</TableCell>
            <TableCell class="tabular-nums">{{ p.collections }}</TableCell>
            <TableCell class="text-right"><Button v-if="!p.collections" variant="ghost" size="sm" @click="removeProfile(p.id)">Eliminar</Button></TableCell>
          </TableRow>
          <TableRow v-if="!profiles?.length"><TableCell colspan="7" class="text-muted-foreground text-center">Sin perfiles: crea uno a partir de un modelo de embeddings del catálogo.</TableCell></TableRow>
        </TableBody>
      </Table>
    </CardContent>
  </Card>

  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader><DialogTitle>Nueva conexión de conocimiento</DialogTitle><DialogDescription>Las credenciales se guardan cifradas y nunca se muestran.</DialogDescription></DialogHeader>
      <form id="rag-conn" class="space-y-4" novalidate autocomplete="off" @submit="submit">
        <Field :data-invalid="!!form.errors.name"><FieldLabel for="rc-name">Nombre</FieldLabel><Input id="rc-name" v-model="form.values.name" data-testid="rag-connection-name" /><FieldError :errors="[form.errors.name]" /></Field>
        <Field>
          <FieldLabel for="rc-kind">Tipo</FieldLabel>
          <Select v-model="form.values.kind">
            <SelectTrigger id="rc-kind"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem v-for="(l, k) in KIND" :key="k" :value="k">{{ l }}</SelectItem></SelectContent>
          </Select>
        </Field>
        <template v-if="form.values.kind !== 'api'">
          <Field :data-invalid="!!form.errors.schema"><FieldLabel for="rc-schema">Esquema</FieldLabel><Input id="rc-schema" v-model="form.values.schema" /><FieldError :errors="[form.errors.schema]" /></Field>
          <Field v-if="form.values.kind === 'postgres'">
            <FieldLabel for="rc-url">Cadena de conexión</FieldLabel>
            <Input id="rc-url" v-model="form.values.connectionUrl" type="password" autocomplete="new-password" placeholder="postgres://usuario:clave@host:5432/base" />
            <FieldDescription>O usa una referencia: env:RAG_DATABASE_URL</FieldDescription>
          </Field>
          <Field v-if="form.values.kind === 'postgres'"><FieldLabel for="rc-ref">Referencia a secreto (opcional)</FieldLabel><Input id="rc-ref" v-model="form.values.credentialRef" placeholder="env:RAG_DATABASE_URL" /></Field>
          <div class="flex items-center gap-2"><Switch id="rc-managed" v-model="form.values.managed" /><Label for="rc-managed">Permitir que el starter cree extensión, esquema e índices</Label></div>
        </template>
        <template v-else>
          <Field :data-invalid="!!form.errors.baseUrl"><FieldLabel for="rc-base">URL base</FieldLabel><Input id="rc-base" v-model="form.values.baseUrl" type="url" placeholder="https://busqueda.example.com/v1" /><FieldError :errors="[form.errors.baseUrl]" /></Field>
          <Field><FieldLabel for="rc-token">Token</FieldLabel><Input id="rc-token" v-model="form.values.token" type="password" autocomplete="new-password" /></Field>
          <p class="text-muted-foreground text-xs">El servicio debe implementar el contrato documentado (capabilities, search y opcionalmente documents).</p>
        </template>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="rag-conn" :disabled="form.submitting.value" data-testid="rag-connection-submit">Crear y diagnosticar</Button></DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="profileOpen">
    <DialogContent>
      <DialogHeader><DialogTitle>Nuevo perfil de embeddings</DialogTitle><DialogDescription>Las dimensiones se toman del catálogo del modelo.</DialogDescription></DialogHeader>
      <form id="rag-profile" class="space-y-4" novalidate @submit="psubmit">
        <Field :data-invalid="!!pform.errors.name"><FieldLabel for="rp-name">Nombre</FieldLabel><Input id="rp-name" v-model="pform.values.name" data-testid="rag-profile-name" /><FieldError :errors="[pform.errors.name]" /></Field>
        <Field :data-invalid="!!pform.errors.key"><FieldLabel for="rp-key">Clave</FieldLabel><Input id="rp-key" v-model="pform.values.key" placeholder="openai-small" data-testid="rag-profile-key" /><FieldError :errors="[pform.errors.key]" /></Field>
        <Field :data-invalid="!!pform.errors.modelCatalogId"><FieldLabel for="rp-model">Modelo de embeddings</FieldLabel><ModelSelect id="rp-model" v-model="pmodel" fn="embedding" /><FieldError :errors="[pform.errors.modelCatalogId]" /></Field>
        <Field>
          <FieldLabel for="rp-metric">Métrica</FieldLabel>
          <Select v-model="pform.values.metric">
            <SelectTrigger id="rp-metric"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="cosine">Coseno</SelectItem><SelectItem value="l2">Euclidiana (L2)</SelectItem><SelectItem value="inner_product">Producto interno</SelectItem></SelectContent>
          </Select>
        </Field>
        <Alert v-if="pform.formError.value" variant="destructive"><AlertDescription>{{ pform.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="rag-profile" :disabled="pform.submitting.value" data-testid="rag-profile-submit">Crear perfil</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
