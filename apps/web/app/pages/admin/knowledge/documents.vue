<script setup lang="ts">
import { ragCollectionsList, ragDocumentsDelete, ragDocumentsGet, ragDocumentsList, ragDocumentsReprocess, type DocumentDetail, type RagDocument } from '@starter/api-client';
import { MoreHorizontal } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Input } from '#ui/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '#ui/components/ui/dropdown-menu';
import { Pagination, PaginationContent, PaginationNext, PaginationPrevious } from '#ui/components/ui/pagination';
import { formatBytes, formatNumber } from '#ui/lib/format';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import StatusBadge from '~/components/shared/StatusBadge.vue';
import DocumentChunksSheet from '~/components/knowledge/DocumentChunksSheet.vue';

definePageMeta({ permission: 'rag.documents.read', feature: 'rag' });
useHead({ title: 'Documentos' });
const api = useApi();
const can = useCan();
const { confirm } = useConfirm();
const route = useRoute();

const query = reactive({ page: 1, collectionId: String(route.query.collection ?? 'all'), status: 'all', search: '' });
const search = ref('');
let debounce: ReturnType<typeof setTimeout> | undefined;
watch(search, (v) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => Object.assign(query, { search: v, page: 1 }), 300);
});
watch(() => [query.collectionId, query.status], () => (query.page = 1));

const { data: collections } = await useAsyncData('rag-docs-collections', () => unwrap(ragCollectionsList({ client: api, query: { page: 1, pageSize: 100 } })).then((r) => r.items));
const { data: page, refresh, status } = await useAsyncData(
  'rag-documents',
  () =>
    unwrap(
      ragDocumentsList({
        client: api,
        query: {
          page: query.page,
          pageSize: 25,
          collectionId: query.collectionId === 'all' ? undefined : query.collectionId,
          status: query.status === 'all' ? undefined : (query.status as 'indexed'),
          search: query.search || undefined,
        },
      }),
    ),
  { watch: [query] },
);

const viewing = ref<DocumentDetail | null>(null);
async function open(d: RagDocument) {
  try {
    viewing.value = await unwrap(ragDocumentsGet({ client: api, path: { id: d.collectionId, documentId: d.id } }));
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function reprocess(d: RagDocument) {
  try {
    await ragDocumentsReprocess({ client: api, path: { id: d.collectionId, documentId: d.id } });
    toast.success('Reprocesamiento en cola', { description: 'Sigue el avance en Conocimiento → Trabajos.' });
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
async function remove(d: RagDocument) {
  if (!(await confirm({ title: `¿Eliminar «${d.title ?? d.externalId}»?`, description: 'Se eliminan sus fragmentos, vectores y el archivo almacenado.', confirmLabel: 'Eliminar', destructive: true }))) return;
  try {
    await ragDocumentsDelete({ client: api, path: { id: d.collectionId, documentId: d.id } });
    toast.success('Eliminación en cola');
    await refresh();
  } catch (err) {
    toast.error(apiError(err).message);
  }
}
const pages = computed(() => page.value?.pageCount ?? 1);
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Documentos" description="Lo indexado en las colecciones que puedes leer. Los documentos restringidos por rol solo los ven esos roles y quienes administran el conocimiento." />

    <div class="flex flex-wrap gap-2">
      <Input v-model="search" placeholder="Buscar por título o URL" class="w-full sm:w-72" aria-label="Buscar documentos" data-testid="docs-search" />
      <ClientOnly>
        <Select v-model="query.collectionId">
          <SelectTrigger class="w-56" aria-label="Colección"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las colecciones</SelectItem>
            <SelectItem v-for="c in collections" :key="c.id" :value="c.id">{{ c.name }}</SelectItem>
          </SelectContent>
        </Select>
      </ClientOnly>
      <Select v-model="query.status">
        <SelectTrigger class="w-40" aria-label="Estado"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">Todo estado</SelectItem><SelectItem value="indexed">Indexado</SelectItem><SelectItem value="processing">Procesando</SelectItem><SelectItem value="pending">Pendiente</SelectItem><SelectItem value="failed">Con error</SelectItem></SelectContent>
      </Select>
      <span class="text-muted-foreground self-center text-sm">{{ formatNumber(page?.total ?? 0) }} documentos</span>
    </div>

    <div class="overflow-x-auto rounded-md border" :aria-busy="status === 'pending'">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Documento</TableHead><TableHead>Colección</TableHead><TableHead>Estado</TableHead><TableHead>Fragmentos</TableHead><TableHead>Tamaño</TableHead><TableHead>Indexado</TableHead><TableHead class="sr-only">Acciones</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="d in page?.items" :key="d.id" :data-testid="`doc-row-${d.title}`">
            <TableCell>
              <button type="button" class="text-left font-medium underline-offset-4 hover:underline" @click="open(d)">{{ d.title ?? d.externalId }}</button>
              <div class="text-muted-foreground max-w-96 truncate text-xs">{{ d.sourceUrl ?? d.mediaType }}<template v-if="d.aclRoles.length"> · solo {{ d.aclRoles.join(', ') }}</template></div>
              <p v-if="d.error" class="text-destructive text-xs">{{ d.error }}</p>
            </TableCell>
            <TableCell><NuxtLink :to="`/admin/knowledge/collections/${d.collectionId}`" class="text-sm underline-offset-4 hover:underline">{{ d.collectionName }}</NuxtLink></TableCell>
            <TableCell><StatusBadge :status="d.status" /></TableCell>
            <TableCell class="tabular-nums">{{ d.chunkCount }}</TableCell>
            <TableCell class="tabular-nums">{{ formatBytes(d.bytes) }}</TableCell>
            <TableCell class="text-sm"><RelativeTime v-if="d.indexedAt" :value="d.indexedAt" /><span v-else>—</span></TableCell>
            <TableCell class="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger as-child><Button variant="ghost" size="icon" :aria-label="`Acciones de ${d.title ?? d.externalId}`"><MoreHorizontal class="size-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @click="open(d)">Ver fragmentos</DropdownMenuItem>
                  <DropdownMenuItem v-if="can('rag.sources.manage')" @click="reprocess(d)">Volver a procesar</DropdownMenuItem>
                  <DropdownMenuSeparator v-if="can('rag.documents.delete')" />
                  <DropdownMenuItem v-if="can('rag.documents.delete')" class="text-destructive" @click="remove(d)">Eliminar</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          <TableRow v-if="!page?.items.length">
            <TableCell colspan="7" class="text-muted-foreground text-center">Sin documentos con esos filtros. Las colecciones conectadas a una API externa no exponen su contenido aquí.</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Pagination v-if="pages > 1" v-slot="{ page: current }" :page="query.page" :total="page?.total ?? 0" :items-per-page="25" @update:page="(p: number) => (query.page = p)">
      <PaginationContent>
        <PaginationPrevious />
        <span class="text-muted-foreground px-3 text-sm">Página {{ current }} de {{ pages }}</span>
        <PaginationNext />
      </PaginationContent>
    </Pagination>

    <DocumentChunksSheet v-model="viewing" />
  </div>
</template>
