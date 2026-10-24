<script setup lang="ts">
import { computed, ref } from 'vue';
import { VisAxis, VisGroupedBar, VisStackedBar, VisXYContainer } from '@unovis/vue';
import { GroupedBar, StackedBar } from '@unovis/ts';
import { ChartColumn, Download, Table2 } from '@lucide/vue';
import { ChartContainer, ChartTooltip, type ChartConfig } from '#ui/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Button } from '#ui/components/ui/button';
import { downloadCsv } from '#ui/lib/csv';
import type { ChartSeries } from '#ui/lib/kit';

/**
 * Bars by category (not by date: use TimeSeriesChart for that): rankings, comparisons, totals by
 * group. `horizontal` suits long labels and rankings; several series are grouped side by side or
 * `stacked`. Same accessibility as the other charts: equivalent table and CSV export.
 *
 *   <BarChart title="Costo por modelo" :data="[{ label: 'gpt-5-mini', cost: 12.4 }, …]"
 *     :series="[{ key: 'cost', label: 'Costo' }]" horizontal :value-format="(v) => formatUsd(String(v))" />
 */
const props = withDefaults(
  defineProps<{
    data: Record<string, unknown>[];
    series: ChartSeries[];
    title: string;
    /** Key of the category label in each row. */
    labelKey?: string;
    horizontal?: boolean;
    stacked?: boolean;
    valueFormat?: (v: number) => string;
    csvName?: string;
    height?: string;
  }>(),
  { labelKey: 'label', horizontal: false, stacked: false, height: 'h-64' },
);
const showTable = ref(false);
const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const config = computed<ChartConfig>(() => Object.fromEntries(props.series.map((s, i) => [`s${i}`, { label: s.label, color: s.color ?? palette[i % palette.length] }])));
const colors = computed(() => props.series.map((s, i) => s.color ?? palette[i % palette.length]!));
const indexed = computed(() => props.data.map((d, i) => ({ ...d, __i: i })));
const x = (d: { __i: number }) => d.__i;
const ys = computed(() => props.series.map((s) => (d: Record<string, unknown>) => Number(d[s.key] ?? 0)));
const fmt = (v: number) => (props.valueFormat ? props.valueFormat(v) : v.toLocaleString());
const labelOf = (i: number | Date) => String(props.data[Math.round(Number(i))]?.[props.labelKey] ?? '');
const categoryTicks = computed(() => props.data.map((_, i) => i));
const hasData = computed(() => props.data.some((d) => props.series.some((s) => Number(d[s.key] ?? 0) !== 0)));
// One series or stacked: StackedBar (it also respects barMaxWidth with few bars).
const useStacked = computed(() => props.stacked || props.series.length === 1);
// Horizontal bars grow with the number of categories.
const style = computed(() => (props.horizontal ? { height: `${Math.max(160, props.data.length * 36 + 40)}px` } : undefined));
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const tooltip = (d: Record<string, unknown>) =>
  `<div class="bg-background min-w-32 rounded-md border px-2.5 py-1.5 text-xs shadow-xl"><div class="mb-1 font-medium">${escapeHtml(String(d[props.labelKey] ?? ''))}</div>${props.series
    .map((s, i) => `<div class="flex items-center justify-between gap-3"><span class="flex items-center gap-1.5"><span class="inline-block size-2 rounded-[2px]" style="background:${colors.value[i]}"></span>${escapeHtml(s.label)}</span><span class="tabular-nums">${escapeHtml(fmt(Number(d[s.key] ?? 0)))}</span></div>`)
    .join('')}</div>`;
const triggers = computed(() => ({ [useStacked.value ? StackedBar.selectors.bar : GroupedBar.selectors.bar]: tooltip }));
function exportCsv() {
  downloadCsv(props.csvName ?? 'datos.csv', props.data, [{ key: props.labelKey, label: 'Categoría' }, ...props.series.map((s) => ({ key: s.key, label: s.label }))]);
}
</script>

<template>
  <figure class="space-y-2" data-slot="bar-chart">
    <figcaption class="flex items-center justify-between gap-2">
      <span class="text-sm font-medium">{{ title }}</span>
      <span class="flex gap-1">
        <Button variant="ghost" size="icon" :aria-label="showTable ? 'Ver gráfico' : 'Ver tabla'" :aria-pressed="showTable" @click="showTable = !showTable">
          <ChartColumn v-if="showTable" class="size-4" />
          <Table2 v-else class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Exportar CSV" @click="exportCsv"><Download class="size-4" /></Button>
      </span>
    </figcaption>
    <div v-if="showTable || !hasData" class="max-h-72 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Categoría</TableHead>
            <TableHead v-for="s in series" :key="s.key" class="text-right">{{ s.label }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="(row, i) in data" :key="i">
            <TableCell>{{ row[labelKey] }}</TableCell>
            <TableCell v-for="s in series" :key="s.key" class="text-right tabular-nums">{{ fmt(Number(row[s.key] ?? 0)) }}</TableCell>
          </TableRow>
          <TableRow v-if="!hasData">
            <TableCell :colspan="series.length + 1" class="text-muted-foreground text-center">Sin datos</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <ClientOnly v-else>
      <template #fallback><div :class="horizontal ? undefined : height" :style="style" class="bg-muted/40 animate-pulse rounded-md" aria-hidden="true" /></template>
      <ChartContainer :config="config" :class="horizontal ? undefined : height" :style="style">
        <VisXYContainer :data="indexed" :margin="{ left: 8, right: 8 }" :y-direction="horizontal ? 'south' : undefined">
          <VisStackedBar v-if="useStacked" :x="x" :y="ys" :color="colors" :orientation="horizontal ? 'horizontal' : 'vertical'" :rounded-corners="3" :bar-max-width="horizontal ? 24 : 48" />
          <VisGroupedBar v-else :x="x" :y="ys" :color="colors" :orientation="horizontal ? 'horizontal' : 'vertical'" :rounded-corners="3" :bar-max-width="horizontal ? 18 : 32" />
          <!-- Category axis: one tick per category (integer positions); value axis: a few round ticks. -->
          <VisAxis v-if="horizontal" type="x" :tick-line="false" :domain-line="false" :grid-line="true" :tick-format="fmt" :num-ticks="3" />
          <VisAxis v-else type="x" :tick-line="false" :domain-line="false" :grid-line="false" :tick-format="labelOf" :tick-values="categoryTicks" />
          <VisAxis v-if="horizontal" type="y" :tick-line="false" :domain-line="false" :grid-line="false" :tick-format="labelOf" :tick-values="categoryTicks" :tick-text-width="120" />
          <VisAxis v-else type="y" :tick-line="false" :domain-line="false" :grid-line="true" :tick-format="fmt" :num-ticks="4" />
          <ChartTooltip :triggers="triggers" />
        </VisXYContainer>
      </ChartContainer>
      <ul v-if="series.length > 1" class="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
        <li v-for="(s, i) in series" :key="s.key" class="flex items-center gap-1.5"><span class="size-2 shrink-0 rounded-[2px]" :style="{ background: colors[i] }" aria-hidden="true" />{{ s.label }}</li>
      </ul>
    </ClientOnly>
  </figure>
</template>
