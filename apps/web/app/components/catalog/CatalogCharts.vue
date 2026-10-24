<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger } from '#ui/components/ui/tabs';
import { formatNumber, formatUsd } from '#ui/lib/format';
import CatalogExample from './CatalogExample.vue';

/** Charts: time series (line/area/bars/stacked), bars by category, distribution and sparkline. */
const series = Array.from({ length: 14 }, (_, i) => ({ x: `2026-10-${String(i + 10).padStart(2, '0')}`, chat: 40 + ((i * 17) % 30), lab: 5 + ((i * 7) % 12) }));
const kind = ref<'line' | 'area' | 'bar' | 'stacked'>('area');
const byModel = [
  { label: 'gpt-5-mini', cost: 12.4, calls: 820 },
  { label: 'claude-sonnet', cost: 8.1, calls: 310 },
  { label: 'gemini-flash', cost: 3.6, calls: 640 },
  { label: 'embeddings', cost: 1.3, calls: 2100 },
];
const byRegion = [
  { label: 'Norte', q1: 120, q2: 140, q3: 132 },
  { label: 'Centro', q1: 220, q2: 205, q3: 260 },
  { label: 'Sur', q1: 90, q2: 115, q3: 128 },
];
const donut = byModel.map((m) => ({ key: m.label, label: m.label, value: m.cost }));
const usd = (v: number) => formatUsd(String(v), 2);

const timeCode = `<TimeSeriesChart title="Solicitudes por día" kind="area" :data="rows" csv-name="solicitudes.csv"
  :series="[{ key: 'chat', label: 'Chat' }, { key: 'lab', label: 'Laboratorio' }]" />
// rows: [{ x: '2026-10-10', chat: 40, lab: 5 }, …]   kind: line | area | bar | stacked`;
const barCode = `<BarChart title="Costo por modelo" :data="byModel" :series="[{ key: 'cost', label: 'Costo' }]"
  horizontal :value-format="(v) => formatUsd(String(v), 2)" />
<BarChart title="Ventas por zona" :data="byRegion" :series="[{ key: 'q1', label: 'T1' }, { key: 'q2', label: 'T2' }]" />
// stacked para apilar series; label-key si la categoría no está en "label"`;
const donutCode = `<DonutChart title="Costo por modelo" :data="[{ key: 'gpt', label: 'gpt-5-mini', value: 12.4 }, …]"
  :value-format="(v) => formatUsd(String(v), 2)" />`;
const sparkCode = `<Sparkline :values="[4, 6, 5, 9, 12]" label="Solicitudes últimos 5 días" />
<Sparkline :values="latency" :area="false" color="var(--chart-3)" :width="120" />`;
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-2">
    <CatalogExample class="lg:col-span-2" title="TimeSeriesChart" description="Series por fecha: línea, área, barras o apiladas. Tabla equivalente y CSV en cada gráfico." :code="timeCode">
      <Tabs v-model="kind">
        <TabsList aria-label="Tipo de gráfico">
          <TabsTrigger value="line">Línea</TabsTrigger>
          <TabsTrigger value="area">Área</TabsTrigger>
          <TabsTrigger value="bar">Barras</TabsTrigger>
          <TabsTrigger value="stacked">Apiladas</TabsTrigger>
        </TabsList>
      </Tabs>
      <TimeSeriesChart title="Solicitudes por día" :kind="kind" :data="series" :series="[{ key: 'chat', label: 'Chat' }, { key: 'lab', label: 'Laboratorio' }]" csv-name="solicitudes.csv" />
    </CatalogExample>
    <CatalogExample title="BarChart horizontal" description="Rankings y etiquetas largas." :code="barCode">
      <BarChart title="Costo por modelo" :data="byModel" :series="[{ key: 'cost', label: 'Costo' }]" horizontal :value-format="usd" csv-name="costo-modelo.csv" />
    </CatalogExample>
    <CatalogExample title="BarChart agrupado" description="Varias series por categoría (o apiladas con stacked)." :code="barCode">
      <BarChart title="Ventas por zona" :data="byRegion" :series="[{ key: 'q1', label: 'T1' }, { key: 'q2', label: 'T2' }, { key: 'q3', label: 'T3' }]" :value-format="formatNumber" csv-name="ventas-zona.csv" />
    </CatalogExample>
    <CatalogExample title="DonutChart" description="Distribución con total al centro, leyenda y tabla." :code="donutCode">
      <DonutChart title="Costo por modelo" :data="donut" :value-format="usd" csv-name="distribucion.csv" />
    </CatalogExample>
    <CatalogExample title="Sparkline" description="Tendencia mínima en SVG (se dibuja también en el servidor), para tarjetas y tablas." :code="sparkCode">
      <div class="flex flex-wrap items-center gap-6">
        <div class="space-y-1 text-sm"><span class="text-muted-foreground block">Solicitudes</span><Sparkline :values="[4, 6, 5, 9, 12, 11, 15]" label="Solicitudes de la semana" /></div>
        <div class="space-y-1 text-sm"><span class="text-muted-foreground block">Latencia</span><Sparkline :values="[320, 300, 410, 280, 260, 240]" :area="false" color="var(--chart-3)" :width="120" label="Latencia" /></div>
        <div class="space-y-1 text-sm"><span class="text-muted-foreground block">Costo</span><Sparkline :values="[1.2, 1.4, 1.1, 1.9, 2.3]" color="var(--chart-2)" label="Costo diario" :value-format="usd" /></div>
      </div>
    </CatalogExample>
  </div>
</template>
