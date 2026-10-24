<script setup lang="ts">
import { ragCollectionsList, ragJobsCancel, ragJobsList, ragJobsRetry, type RagJob } from '@starter/api-client';
import { RefreshCw } from '@lucide/vue';
import { toast } from 'vue-sonner';
import { Button } from '#ui/components/ui/button';
import { Switch } from '#ui/components/ui/switch';
import { Label } from '#ui/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '#ui/components/ui/sheet';
import { Pagination, PaginationContent, PaginationNext, PaginationPrevious } from '#ui/components/ui/pagination';
import { formatDate, formatNumber, formatUsd } from '#ui/lib/format';
import RelativeTime from '#ui/components/common/RelativeTime.vue';
import JobProgress from '~/components/knowledge/JobProgress.vue';

definePageMeta({ permission: 'rag.jobs.manage', feature: 'rag' });
useHead({ title: 'Trabajos de indexación' });
const api = useApi();
const notify = useNotify();
const route = useRoute();
const query = reactive({ page: 1, status: 'all', collectionId: String(route.query.collection ?? 'all'), active: false });
watch(() => [query.status, query.collectionId, query.active], () => (query.page = 1));

const { data: collections } = await useAsyncData('rag-jobs-collections', () => unwrap(ragCollectionsList({ client: api, query: { page: 1, pageSize: 100 } })).then((r) => r.items));
const { data: page, refresh } = await useAsyncData(
  'rag-jobs',
  () =>
    unwrap(
      ragJobsList({
        client: api,
        query: {
          page: query.page,
          pageSize: 25,
          status: query.status === 'all' ? undefined : (query.status as RagJob['status']),
          collectionId: query.collectionId === 'all' ? undefined : query.collectionId,
          active: query.active ? 'true' : undefined,
        },
      }),
    ),
  { watch: [query] },
);

const ACTIVE = ['queued', 'running', 'retrying'];
const anyActive = computed(() => (page.value?.items ?? []).some((j) => ACTIVE.includes(j.status)));
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  // Poll quickly while something is moving; slowly otherwise (new jobs from schedules or other admins).
  let ticks = 0;
  timer = setInterval(() => {
    ticks++;
    if (anyActive.value || ticks % 5 === 0) void refresh();
  }, 2000);
});
onBeforeUnmount(() => clearInterval(timer));

async function cancel(j: RagJob) {
  try {
    const updated = await unwrap(ragJobsCancel({ client: api, path: { id: j.id } }));
    toast.success(updated.status === 'cancelled' ? 'Trabajo cancelado' : 'Cancelación solicitada', { description: updated.status === 'cancelled' ? undefined : 'Se detendrá en el siguiente punto seguro.' });
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}
async function retry(j: RagJob) {
  try {
    await ragJobsRetry({ client: api, path: { id: j.id } });
    toast.success('Trabajo reencolado');
    await refresh();
  } catch (err) {
    notify.error(err);
  }
}

const detail = ref<RagJob | null>(null);
watch(page, (p) => {
  if (detail.value) detail.value = p?.items.find((j) => j.id === detail.value!.id) ?? detail.value;
});
const UNIT_LABELS: Record<string, string> = { unpriced_calls: 'Llamadas sin tarifa (costo desconocido)', embedding_tokens: 'Tokens de embeddings', documents: 'Documentos', chunks: 'Fragmentos', tokens: 'Tokens de embeddings', bytes: 'Bytes', urls: 'URLs', skipped: 'Omitidos', failed: 'Fallidos', deleted: 'Eliminados' };
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Trabajos de indexación" description="Ingesta, reindexación y purgas durables. Se reintentan con espera exponencial y sobreviven reinicios del worker.">
      <template #actions><Button variant="outline" @click="refresh()"><RefreshCw class="size-4" /> Actualizar</Button></template>
    </PageHeader>

    <div class="flex flex-wrap items-center gap-3">
      <Select v-model="query.status">
        <SelectTrigger class="w-44" aria-label="Estado"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todo estado</SelectItem>
          <SelectItem value="queued">En cola</SelectItem>
          <SelectItem value="running">En curso</SelectItem>
          <SelectItem value="retrying">Reintentando</SelectItem>
          <SelectItem value="succeeded">Completados</SelectItem>
          <SelectItem value="failed">Fallidos</SelectItem>
          <SelectItem value="cancelled">Cancelados</SelectItem>
        </SelectContent>
      </Select>
      <ClientOnly>
        <Select v-model="query.collectionId">
          <SelectTrigger class="w-56" aria-label="Colección"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las colecciones</SelectItem>
            <SelectItem v-for="c in collections" :key="c.id" :value="c.id">{{ c.name }}</SelectItem>
          </SelectContent>
        </Select>
      </ClientOnly>
      <div class="flex items-center gap-2"><Switch id="jobs-active" v-model="query.active" /><Label for="jobs-active">Solo activos</Label></div>
    </div>

    <div class="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Trabajo</TableHead><TableHead>Progreso</TableHead><TableHead>Intentos</TableHead><TableHead>Costo</TableHead><TableHead>Creado</TableHead><TableHead class="sr-only">Acciones</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="j in page?.items" :key="j.id" :data-testid="`job-row-${j.kind}`" :data-status="j.status">
            <TableCell>
              <button type="button" class="text-left font-medium underline-offset-4 hover:underline" @click="detail = j">{{ jobKindLabel(j.kind) }}</button>
              <div class="text-muted-foreground text-xs">
                <NuxtLink v-if="j.collectionId" :to="`/admin/knowledge/collections/${j.collectionId}`" class="underline-offset-4 hover:underline">{{ j.collectionName ?? 'colección' }}</NuxtLink>
              </div>
            </TableCell>
            <TableCell><JobProgress :job="j" /></TableCell>
            <TableCell class="tabular-nums">{{ j.attempts }}/{{ j.maxAttempts }}</TableCell>
            <TableCell class="tabular-nums text-sm">
              {{ formatUsd(j.costUsd) }}<span v-if="j.units.unpriced_calls" class="text-amber-600 dark:text-amber-400" title="Hubo llamadas sin tarifa vigente: el costo real es mayor"> + desconocido</span>
              <div v-if="j.budgetUsd" class="text-muted-foreground text-xs">de {{ formatUsd(j.budgetUsd) }}</div>
            </TableCell>
            <TableCell class="text-sm"><RelativeTime :value="j.createdAt" /></TableCell>
            <TableCell class="text-right whitespace-nowrap">
              <Button v-if="ACTIVE.includes(j.status)" variant="ghost" size="sm" data-testid="job-cancel" @click="cancel(j)">Cancelar</Button>
              <Button v-if="['failed', 'cancelled'].includes(j.status)" variant="ghost" size="sm" data-testid="job-retry" @click="retry(j)">Reintentar</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="!page?.items.length"><TableCell colspan="6" class="text-muted-foreground text-center">Sin trabajos con esos filtros.</TableCell></TableRow>
        </TableBody>
      </Table>
    </div>

    <Pagination v-if="(page?.pageCount ?? 1) > 1" v-slot="{ page: p }" :total="page?.total ?? 0" :items-per-page="25" :page="query.page" @update:page="(n: number) => (query.page = n)">
      <PaginationContent><PaginationPrevious /><span class="px-2 text-sm">{{ p }} / {{ page?.pageCount }}</span><PaginationNext /></PaginationContent>
    </Pagination>

    <Sheet :open="!!detail" @update:open="(v: boolean) => !v && (detail = null)">
      <SheetContent class="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{{ detail ? jobKindLabel(detail.kind) : '' }}</SheetTitle>
          <SheetDescription>{{ detail?.collectionName }} · <span class="font-mono text-xs">{{ detail?.id }}</span></SheetDescription>
        </SheetHeader>
        <div v-if="detail" class="space-y-5 px-4 pb-6 text-sm">
          <JobProgress :job="detail" />
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt class="text-muted-foreground">Creado</dt><dd>{{ formatDate(detail.createdAt) }}</dd>
            <dt class="text-muted-foreground">Iniciado</dt><dd>{{ detail.startedAt ? formatDate(detail.startedAt) : '—' }}</dd>
            <dt class="text-muted-foreground">Terminado</dt><dd>{{ detail.finishedAt ? formatDate(detail.finishedAt) : '—' }}</dd>
            <dt class="text-muted-foreground">Último latido</dt><dd><RelativeTime v-if="detail.heartbeatAt" :value="detail.heartbeatAt" /><span v-else>—</span></dd>
            <dt class="text-muted-foreground">Intentos</dt><dd>{{ detail.attempts }} de {{ detail.maxAttempts }}</dd>
            <dt class="text-muted-foreground">Costo de embeddings</dt><dd>{{ formatUsd(detail.costUsd) }}<template v-if="detail.units.unpriced_calls"> + desconocido</template><template v-if="detail.budgetUsd"> (tope {{ formatUsd(detail.budgetUsd) }})</template></dd>
          </dl>
          <section v-if="Object.keys(detail.units).length">
            <h3 class="mb-2 font-medium">Unidades procesadas</h3>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
              <template v-for="(v, k) in detail.units" :key="k"><dt class="text-muted-foreground">{{ UNIT_LABELS[k] ?? k }}</dt><dd class="tabular-nums">{{ formatNumber(v) }}</dd></template>
            </dl>
          </section>
          <section v-if="Object.keys(detail.stageTimings).length">
            <h3 class="mb-2 font-medium">Tiempo por etapa</h3>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
              <template v-for="(ms, k) in detail.stageTimings" :key="k"><dt class="text-muted-foreground">{{ k }}</dt><dd class="tabular-nums">{{ formatNumber(ms) }} ms</dd></template>
            </dl>
          </section>
          <section v-if="detail.error">
            <h3 class="mb-2 font-medium">Error</h3>
            <p class="text-destructive whitespace-pre-wrap">{{ detail.error }}</p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  </div>
</template>
