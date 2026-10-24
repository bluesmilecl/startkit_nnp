<script setup lang="ts">
import { computed, ref } from 'vue';
import { VisDonut, VisSingleContainer } from '@unovis/vue';
import { Donut } from '@unovis/ts';
import { Download, Table2, PieChart } from '@lucide/vue';
import { ChartContainer, ChartLegendContent, ChartTooltip, ChartTooltipContent, componentToString, type ChartConfig } from '#ui/components/ui/chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#ui/components/ui/table';
import { Button } from '#ui/components/ui/button';
import { downloadCsv } from '#ui/lib/csv';

const props = defineProps<{ data: { key: string; label: string; value: number }[]; title: string; valueFormat?: (v: number) => string; csvName?: string }>();
const showTable = ref(false);
const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const config = computed<ChartConfig>(() => Object.fromEntries(props.data.map((d, i) => [d.key, { label: d.label, color: palette[i % palette.length] }])));
const fmt = (v: number) => (props.valueFormat ? props.valueFormat(v) : v.toLocaleString());
const total = computed(() => props.data.reduce((s, d) => s + d.value, 0));
</script>

<template>
  <figure class="space-y-2">
    <figcaption class="flex items-center justify-between gap-2">
      <span class="text-sm font-medium">{{ title }}</span>
      <span class="flex gap-1">
        <Button variant="ghost" size="icon" :aria-label="showTable ? 'Ver gráfico' : 'Ver tabla'" @click="showTable = !showTable">
          <PieChart v-if="showTable" class="size-4" /><Table2 v-else class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Exportar CSV" @click="downloadCsv(csvName ?? 'datos.csv', data)"><Download class="size-4" /></Button>
      </span>
    </figcaption>
    <Table v-if="showTable || !total">
      <TableHeader><TableRow><TableHead>Categoría</TableHead><TableHead class="text-right">Valor</TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="d in data" :key="d.key"><TableCell>{{ d.label }}</TableCell><TableCell class="text-right tabular-nums">{{ fmt(d.value) }}</TableCell></TableRow>
        <TableRow v-if="!total"><TableCell colspan="2" class="text-muted-foreground text-center">Sin datos</TableCell></TableRow>
      </TableBody>
    </Table>
    <ChartContainer v-else :config="config" class="mx-auto aspect-square max-h-60">
      <VisSingleContainer :data="data" :margin="{ top: 10, bottom: 10 }">
        <VisDonut :value="(d: { value: number }) => d.value" :color="(_d: unknown, i: number) => palette[i % palette.length]" :arc-width="28" :central-label="fmt(total)" />
        <ChartTooltip :triggers="{ [Donut.selectors.segment]: componentToString(config, ChartTooltipContent, { hideLabel: true })! }" />
      </VisSingleContainer>
      <ChartLegendContent />
    </ChartContainer>
  </figure>
</template>
