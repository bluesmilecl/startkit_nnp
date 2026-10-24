<script setup lang="ts">
import { computed, ref } from 'vue';
import { VisArea, VisAxis, VisGroupedBar, VisLine, VisStackedBar, VisXYContainer } from '@unovis/vue';
import { Download, Table2, LineChart } from '@lucide/vue';
import { ChartContainer, ChartCrosshair, ChartTooltip, ChartTooltipContent, componentToString, type ChartConfig } from '#ui/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Button } from '#ui/components/ui/button';
import { downloadCsv } from '#ui/lib/csv';

export interface Series {
  key: string;
  label: string;
  color?: string;
}

/**
 * Accessible time series chart (shadcn-vue chart on Unovis) with an equivalent data table and
 * CSV export. `data` rows use `x` (ISO date or label) plus one numeric value per series key.
 */
const props = withDefaults(
  defineProps<{
    data: Record<string, unknown>[];
    series: Series[];
    kind?: 'line' | 'area' | 'bar' | 'stacked';
    title: string;
    xLabel?: string;
    valueFormat?: (v: number) => string;
    csvName?: string;
    height?: string;
  }>(),
  { kind: 'line', xLabel: 'Fecha', height: 'h-64' },
);
const showTable = ref(false);
const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const config = computed<ChartConfig>(() =>
  Object.fromEntries(props.series.map((s, i) => [s.key, { label: s.label, color: s.color ?? palette[i % palette.length] }])),
);
const indexed = computed(() => props.data.map((d, i) => ({ ...d, __i: i })));
const x = (d: { __i: number }) => d.__i;
const ys = computed(() => props.series.map((s) => (d: Record<string, unknown>) => Number(d[s.key] ?? 0)));
const colors = computed(() => props.series.map((s) => config.value[s.key]?.color as string));
const tickFormat = (i: number | Date) => {
  const v = props.data[Math.round(Number(i))]?.x;
  if (typeof v !== 'string') return '';
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(5, 10) : v;
};
const fmt = (v: number) => (props.valueFormat ? props.valueFormat(v) : v.toLocaleString());
function exportCsv() {
  downloadCsv(props.csvName ?? 'datos.csv', props.data, [{ key: 'x', label: props.xLabel }, ...props.series.map((s) => ({ key: s.key, label: s.label }))]);
}
</script>

<template>
  <figure class="space-y-2">
    <figcaption class="flex items-center justify-between gap-2">
      <span class="text-sm font-medium">{{ title }}</span>
      <span class="flex gap-1">
        <Button variant="ghost" size="icon" :aria-label="showTable ? 'Ver gráfico' : 'Ver tabla'" :aria-pressed="showTable" @click="showTable = !showTable">
          <LineChart v-if="showTable" class="size-4" />
          <Table2 v-else class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Exportar CSV" @click="exportCsv"><Download class="size-4" /></Button>
      </span>
    </figcaption>
    <div v-if="showTable || !data.length" class="max-h-72 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{{ xLabel }}</TableHead>
            <TableHead v-for="s in series" :key="s.key" class="text-right">{{ s.label }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(row, i) in data" :key="i">
            <TableCell>{{ row.x }}</TableCell>
            <TableCell v-for="s in series" :key="s.key" class="text-right tabular-nums">{{ fmt(Number(row[s.key] ?? 0)) }}</TableCell>
          </TableRow>
          <TableRow v-if="!data.length">
            <TableCell :colspan="series.length + 1" class="text-muted-foreground text-center">Sin datos en el período</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <ChartContainer v-else :config="config" :class="height" cursor>
      <VisXYContainer :data="indexed" :margin="{ left: 8, right: 8 }">
        <template v-if="kind === 'area'">
          <VisArea v-for="(y, i) in ys" :key="i" :x="x" :y="y" :color="colors[i]" :opacity="0.25" />
          <VisLine v-for="(y, i) in ys" :key="`l${i}`" :x="x" :y="y" :color="colors[i]" />
        </template>
        <VisLine v-else-if="kind === 'line'" v-for="(y, i) in ys" :key="i" :x="x" :y="y" :color="colors[i]" />
        <VisGroupedBar v-else-if="kind === 'bar'" :x="x" :y="ys" :color="colors" :rounded-corners="4" />
        <VisStackedBar v-else :x="x" :y="ys" :color="colors" :rounded-corners="2" />
        <VisAxis type="x" :x="x" :tick-line="false" :domain-line="false" :grid-line="false" :tick-format="tickFormat" :num-ticks="6" />
        <VisAxis type="y" :tick-line="false" :domain-line="false" :tick-format="fmt" :num-ticks="4" />
        <ChartTooltip />
        <ChartCrosshair :template="componentToString(config, ChartTooltipContent, { labelFormatter: (i: number | Date) => String(data[Number(i)]?.x ?? '') })" :color="colors" />
      </VisXYContainer>
    </ChartContainer>
  </figure>
</template>
