<script setup lang="ts">
import { ragCollectionsCreate, ragCollectionsList, ragConnectionsList, ragProfilesList } from '@starter/api-client';
import { CreateCollectionInput } from '@starter/contracts';
import { Boxes, Plus } from '@lucide/vue';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Textarea } from '#ui/components/ui/textarea';
import { Badge } from '#ui/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#ui/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Alert, AlertDescription } from '#ui/components/ui/alert';
import { formatBytes, formatNumber } from '#ui/lib/format';
import RolesAclInput from '~/components/knowledge/RolesAclInput.vue';

definePageMeta({ permission: ['rag.collections.read', 'rag.collections.manage'], feature: 'rag' });
useHead({ title: 'Colecciones' });
const api = useApi();
const can = useCan();
const { data, refresh } = await useAsyncData('rag-collections', () => unwrap(ragCollectionsList({ client: api, query: { page: 1, pageSize: 100 } })));
const { data: connections } = await useAsyncData('rag-connections-min', () => (can('rag.collections.manage') ? unwrap(ragConnectionsList({ client: api })) : Promise.resolve([])));
const { data: profiles } = await useAsyncData('rag-profiles-min', () => (can('rag.collections.manage') ? unwrap(ragProfilesList({ client: api })) : Promise.resolve([])));
const ready = computed(() => (connections.value ?? []).filter((c) => c.status === 'ready'));

const open = ref(false);
const form = useZodForm(CreateCollectionInput, { name: '', slug: '', ragConnectionId: '', embeddingProfileId: null, language: 'spanish', visibility: 'organization', aclRoles: [], aclUsers: [], chunking: { size: 1200, overlap: 150 }, retrieval: { method: 'hybrid', topK: 6, minScore: 0 } });
const selectedConn = computed(() => connections.value?.find((c) => c.id === form.values.ragConnectionId));
const profileModel = computed({ get: () => form.values.embeddingProfileId ?? undefined, set: (v: string | undefined) => (form.values.embeddingProfileId = v ?? null) });
const description = nullableModel(form.values, 'description');
const externalRef = nullableModel(form.values, 'externalRef');
// The identifier follows the name until the person edits it.
const slugEdited = ref(false);
watch(
  () => form.values.name,
  (n) => {
    if (!slugEdited.value) form.values.slug = slugify(n ?? '');
  },
);
function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
const submit = form.handleSubmit(async (values) => {
  const c = await unwrap(ragCollectionsCreate({ client: api, body: values }));
  open.value = false;
  form.reset();
  await refresh();
  await navigateTo(`/admin/knowledge/collections/${c.id}`);
});
</script>

<template>
  <PageHeader title="Colecciones" description="Conjuntos de documentos con su propio perfil de embeddings, fragmentación y permisos de acceso.">
    <template v-if="can('rag.collections.manage')" #actions><Button data-testid="collection-new" @click="open = true"><Plus class="size-4" /> Nueva colección</Button></template>
  </PageHeader>
  <EmptyState v-if="data && !data.total" title="Sin colecciones" :description="ready.length || !can('rag.collections.manage') ? 'Crea una colección y agrega documentos.' : 'Primero crea y activa una conexión de conocimiento.'" :icon="Boxes">
    <Button v-if="!ready.length && can('rag.collections.manage')" as-child variant="outline"><NuxtLink to="/admin/knowledge/connections">Ir a conexiones</NuxtLink></Button>
  </EmptyState>
  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <NuxtLink v-for="c in data?.items" :key="c.id" :to="`/admin/knowledge/collections/${c.id}`" class="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none" :data-testid="`collection-${c.slug}`">
      <Card class="hover:border-primary/50 h-full transition-colors">
        <CardHeader>
          <CardTitle class="flex items-center gap-2">{{ c.name }} <Badge v-if="c.status !== 'active'" variant="outline">{{ c.status === 'paused' ? 'pausada' : 'eliminando' }}</Badge></CardTitle>
          <CardDescription>{{ c.connection.name }}{{ c.profile ? ` · ${c.profile.modelId} (${c.profile.dimensions})` : '' }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-2 text-sm">
          <p v-if="c.description" class="text-muted-foreground line-clamp-2">{{ c.description }}</p>
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
            <span>{{ formatNumber(c.stats.indexed) }}/{{ formatNumber(c.stats.documents) }} indexados</span>
            <span>{{ formatNumber(c.stats.chunks) }} fragmentos</span>
            <span>{{ formatBytes(c.stats.bytes) }}</span>
            <span v-if="c.stats.failed" class="text-destructive">{{ c.stats.failed }} con error</span>
          </div>
          <div class="flex flex-wrap gap-1">
            <Badge variant="secondary">{{ c.visibility === 'organization' ? 'Toda la organización' : 'Restringida' }}</Badge>
            <Badge v-if="c.buildingIndexVersionId" variant="outline">reindexando</Badge>
          </div>
        </CardContent>
      </Card>
    </NuxtLink>
  </div>

  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Nueva colección</DialogTitle><DialogDescription>El perfil de embeddings y el almacén no se pueden cambiar sin reindexar.</DialogDescription></DialogHeader>
      <form id="col-form" class="space-y-4" novalidate @submit="submit">
        <div class="grid grid-cols-2 gap-3">
          <Field :data-invalid="!!form.errors.name"><FieldLabel for="cf-name">Nombre</FieldLabel><Input id="cf-name" v-model="form.values.name" data-testid="collection-name" /><FieldError :errors="[form.errors.name]" /></Field>
          <Field :data-invalid="!!form.errors.slug"><FieldLabel for="cf-slug">Identificador</FieldLabel><Input id="cf-slug" v-model="form.values.slug" @input="slugEdited = true" /><FieldError :errors="[form.errors.slug]" /></Field>
        </div>
        <Field><FieldLabel for="cf-desc">Descripción</FieldLabel><Textarea id="cf-desc" v-model="description" rows="2" /></Field>
        <Field :data-invalid="!!form.errors.ragConnectionId">
          <FieldLabel for="cf-conn">Conexión</FieldLabel>
          <Select v-model="form.values.ragConnectionId">
            <SelectTrigger id="cf-conn" data-testid="collection-connection"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
            <SelectContent><SelectItem v-for="c in ready" :key="c.id" :value="c.id">{{ c.name }}</SelectItem></SelectContent>
          </Select>
          <FieldDescription v-if="!ready.length">No hay conexiones listas.</FieldDescription>
          <FieldError :errors="[form.errors.ragConnectionId]" />
        </Field>
        <Field v-if="selectedConn && selectedConn.kind !== 'api'">
          <FieldLabel for="cf-profile">Perfil de embeddings</FieldLabel>
          <Select v-model="profileModel">
            <SelectTrigger id="cf-profile" data-testid="collection-profile"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
            <SelectContent><SelectItem v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }} · {{ p.modelId }} ({{ p.dimensions }})</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field v-if="selectedConn?.kind === 'api'"><FieldLabel for="cf-ext">Colección remota</FieldLabel><Input id="cf-ext" v-model="externalRef" placeholder="identificador en el servicio" /></Field>
        <div class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel for="cf-lang">Idioma</FieldLabel>
            <Select v-model="form.values.language">
              <SelectTrigger id="cf-lang"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="spanish">Español</SelectItem><SelectItem value="english">Inglés</SelectItem><SelectItem value="portuguese">Portugués</SelectItem><SelectItem value="simple">Sin idioma</SelectItem></SelectContent>
            </Select>
            <FieldDescription>Para la búsqueda de texto completo.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="cf-vis">Acceso</FieldLabel>
            <Select v-model="form.values.visibility">
              <SelectTrigger id="cf-vis"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="organization">Toda la organización</SelectItem><SelectItem value="restricted">Solo roles elegidos</SelectItem></SelectContent>
            </Select>
          </Field>
        </div>
        <Field v-if="form.values.visibility === 'restricted'"><FieldLabel>Roles con acceso</FieldLabel><RolesAclInput v-model="form.values.aclRoles!" /></Field>
        <div class="grid grid-cols-2 gap-3">
          <Field><FieldLabel for="cf-size">Tamaño de fragmento (caracteres)</FieldLabel><Input id="cf-size" v-model.number="form.values.chunking!.size" type="number" min="200" max="8000" /></Field>
          <Field><FieldLabel for="cf-ov">Solapamiento</FieldLabel><Input id="cf-ov" v-model.number="form.values.chunking!.overlap" type="number" min="0" max="2000" /></Field>
        </div>
        <Alert v-if="form.formError.value" variant="destructive"><AlertDescription>{{ form.formError.value }}</AlertDescription></Alert>
      </form>
      <DialogFooter><Button type="submit" form="col-form" :disabled="form.submitting.value" data-testid="collection-submit">Crear colección</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
