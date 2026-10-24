<script setup lang="ts">
import { ragAnalytics, ragCollectionsList } from '@starter/api-client';
import { Activity, Ban, Clock, DollarSign, FileWarning, SearchX, ThumbsUp } from '@lucide/vue';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { formatNumber, formatUsd } from '#ui/lib/format';
import StatCard from '#ui/components/common/StatCard.vue';
import TimeSeriesChart from '#ui/components/charts/TimeSeriesChart.vue';

definePageMeta({ permission: 'rag.analytics.read', feature: 'rag' });
useHead({ title: 'Analítica de conocimiento' });
const api = useApi();
const filters = reactive({ days: '30', collectionId: 'all' });
const { data: collections } = await useAsyncData('rag-analytics-collections', () => unwrap(ragCollectionsList({ client: api, query: { page: 1, pageSize: 100 } })).then((r) => r.items));
const { data, status } = await useAsyncData(
  'rag-analytics',
  () => unwrap(ragAnalytics({ client: api, query: { days: Number(filters.days), collectionId: filters.collectionId === 'all' ? undefined : filters.collectionId } })),
  { watch: [filters] },
);
const loading = computed(() => status.value === 'pending');
const t = computed(() => data.value?.totals);
function rate(part: number | undefined, total: number | undefined) {
  return total ? `${Math.round(((part ?? 0) / total) * 100)} %` : '—';
}
const daily = computed(() => (data.value?.daily ?? []).map((d) => ({ x: d.date, ...d, answered: d.queries - d.abstained })));
const ms = (v: number) => `${formatNumber(Math.round(v))} ms`;
const usd = (v: number) => formatUsd(String(v));
</script>

<template>
  <div class="space-y-6">
    <PageHeader title="Analítica de conocimiento" description="Consultas del chat con conocimiento, abstenciones, latencia, ingesta, costos de embeddings y retroalimentación de las respuestas.">
      <template #actions>
        <ClientOnly>
          <Select v-model="filters.collectionId">
            <SelectTrigger class="w-52" aria-label="Colección"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las colecciones</SelectItem>
              <SelectItem v-for="c in collections" :key="c.id" :value="c.id">{{ c.name }}</SelectItem>
            </SelectContent>
          </Select>
        </ClientOnly>
        <Select v-model="filters.days">
          <SelectTrigger class="w-44" aria-label="Período"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="7">Últimos 7 días</SelectItem><SelectItem value="30">Últimos 30 días</SelectItem><SelectItem value="90">Últimos 90 días</SelectItem></SelectContent>
        </Select>
      </template>
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard title="Consultas" :icon="Activity" :loading="loading" :value="formatNumber(t?.queries)" :hint="`${formatNumber(t?.withoutHits)} sin resultados (${rate(t?.withoutHits, t?.queries)})`" data-testid="rag-stat-queries" />
      <StatCard title="Abstenciones" :icon="Ban" :loading="loading" :value="rate(t?.abstained, t?.queries)" :hint="`${formatNumber(t?.abstained)} respuestas sin evidencia suficiente`" />
      <StatCard title="Latencia de recuperación" :icon="Clock" :loading="loading" :value="t?.avgLatencyMs === null || t?.avgLatencyMs === undefined ? '—' : `${formatNumber(t.avgLatencyMs)} ms`" :hint="t?.p95LatencyMs ? `p95 ${formatNumber(t.p95LatencyMs)} ms` : undefined" />
      <StatCard title="Costo de embeddings" :icon="DollarSign" :loading="loading" :value="formatUsd(t?.embeddingCostUsd)" hint="Ingesta, reindexación y consultas" />
      <StatCard title="Trabajos de ingesta" :icon="FileWarning" :loading="loading" :value="formatNumber(t?.ingestionJobs)" :hint="`${formatNumber(t?.failedJobs)} fallidos`" />
      <StatCard title="Retroalimentación" :icon="ThumbsUp" :loading="loading" :value="`${formatNumber(t?.positiveFeedback)} 👍 · ${formatNumber(t?.negativeFeedback)} 👎`" :hint="t && t.positiveFeedback + t.negativeFeedback ? `${rate(t.positiveFeedback, t.positiveFeedback + t.negativeFeedback)} positiva` : 'Sin calificaciones'" />
      <StatCard title="Sin resultados" :icon="SearchX" :loading="loading" :value="formatNumber(t?.withoutHits)" hint="Señal de contenido faltante" />
    </div>

    <Card>
      <CardHeader><CardTitle class="text-base">Evolución diaria</CardTitle><CardDescription>Días en UTC. Cada gráfico incluye su tabla equivalente y exportación CSV.</CardDescription></CardHeader>
      <CardContent>
        <Tabs default-value="queries">
          <TabsList>
            <TabsTrigger value="queries">Consultas</TabsTrigger>
            <TabsTrigger value="latency">Latencia</TabsTrigger>
            <TabsTrigger value="ingest">Ingesta</TabsTrigger>
            <TabsTrigger value="cost">Costo</TabsTrigger>
          </TabsList>
          <TabsContent value="queries">
            <TimeSeriesChart title="Consultas por día" kind="stacked" :data="daily" :series="[{ key: 'answered', label: 'Respondidas' }, { key: 'abstained', label: 'Abstenciones' }]" csv-name="consultas-rag.csv" />
          </TabsContent>
          <TabsContent value="latency">
            <TimeSeriesChart title="Latencia media de recuperación" kind="line" :data="daily.map((d) => ({ ...d, avgLatencyMs: d.avgLatencyMs ?? 0 }))" :series="[{ key: 'avgLatencyMs', label: 'Latencia media' }]" :value-format="ms" csv-name="latencia-rag.csv" />
          </TabsContent>
          <TabsContent value="ingest">
            <TimeSeriesChart title="Documentos procesados" kind="stacked" :data="daily" :series="[{ key: 'ingested', label: 'Indexados' }, { key: 'failed', label: 'Fallidos' }]" csv-name="ingesta-rag.csv" />
          </TabsContent>
          <TabsContent value="cost">
            <TimeSeriesChart title="Costo diario de embeddings" kind="bar" :data="daily" :series="[{ key: 'embeddingCostUsd', label: 'Costo (USD)' }]" :value-format="usd" csv-name="costo-embeddings.csv" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>

    <div class="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle class="text-base">Preguntas más frecuentes</CardTitle><CardDescription>Texto normalizado; visible solo con permiso de analítica.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Consulta</TableHead><TableHead class="text-right">Veces</TableHead><TableHead class="text-right">Sin resultados</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow v-for="q in data?.topQueries ?? []" :key="q.query">
                <TableCell class="max-w-80 truncate">{{ q.query }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ q.count }}</TableCell>
                <TableCell class="text-right tabular-nums" :class="q.withoutHits ? 'text-destructive' : ''">{{ q.withoutHits }}</TableCell>
              </TableRow>
              <TableRow v-if="!data?.topQueries?.length"><TableCell colspan="3" class="text-muted-foreground text-center">Sin consultas en el período.</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle class="text-base">Documentos más recuperados</CardTitle><CardDescription>Cuántas veces aparecieron en resultados y cuántas fueron citados en una respuesta.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Documento</TableHead><TableHead class="text-right">Recuperado</TableHead><TableHead class="text-right">Citado</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow v-for="d in data?.topDocuments ?? []" :key="d.documentId">
                <TableCell class="max-w-80 truncate">{{ d.title ?? d.documentId }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ d.hits }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ d.cited }}</TableCell>
              </TableRow>
              <TableRow v-if="!data?.topDocuments.length"><TableCell colspan="3" class="text-muted-foreground text-center">Sin datos.</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader><CardTitle class="text-base">Por colección</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Colección</TableHead><TableHead class="text-right">Consultas</TableHead><TableHead class="text-right">Documentos</TableHead><TableHead class="text-right">Fragmentos</TableHead></TableRow></TableHeader>
          <TableBody>
            <TableRow v-for="c in data?.byCollection ?? []" :key="c.collectionId">
              <TableCell><NuxtLink :to="`/admin/knowledge/collections/${c.collectionId}`" class="underline-offset-4 hover:underline">{{ c.name }}</NuxtLink></TableCell>
              <TableCell class="text-right tabular-nums">{{ formatNumber(c.queries) }}</TableCell>
              <TableCell class="text-right tabular-nums">{{ formatNumber(c.documents) }}</TableCell>
              <TableCell class="text-right tabular-nums">{{ formatNumber(c.chunks) }}</TableCell>
            </TableRow>
            <TableRow v-if="!data?.byCollection.length"><TableCell colspan="4" class="text-muted-foreground text-center">Sin colecciones.</TableCell></TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
