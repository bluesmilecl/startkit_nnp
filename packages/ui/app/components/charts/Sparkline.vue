<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber } from '#ui/lib/format';

/**
 * Tiny inline trend (plain SVG: renders on the server, no chart library). For StatCard, tables
 * and cards. The accessible label summarizes the series; pass `label` to name it.
 *
 *   <Sparkline :values="[4, 6, 5, 9, 12]" label="Solicitudes últimos 5 días" />
 */
const props = withDefaults(defineProps<{ values: number[]; label?: string; area?: boolean; color?: string; width?: number; height?: number; valueFormat?: (v: number) => string }>(), {
  area: true,
  color: 'var(--chart-1)',
  width: 96,
  height: 28,
});
const PAD = 2;
const points = computed(() => {
  const v = props.values.length === 1 ? [props.values[0]!, props.values[0]!] : props.values;
  if (!v.length) return [];
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const stepX = (props.width - PAD * 2) / Math.max(1, v.length - 1);
  return v.map((n, i) => [PAD + i * stepX, props.height - PAD - ((n - min) / span) * (props.height - PAD * 2)] as const);
});
const line = computed(() => points.value.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
const areaPath = computed(() => (points.value.length ? `${line.value} L${points.value.at(-1)![0].toFixed(1)},${props.height} L${points.value[0]![0].toFixed(1)},${props.height} Z` : ''));
const fmt = (n: number) => (props.valueFormat ? props.valueFormat(n) : formatNumber(n));
const summary = computed(() => {
  if (!props.values.length) return `${props.label ?? 'Tendencia'}: sin datos`;
  const first = props.values[0]!;
  const last = props.values.at(-1)!;
  return `${props.label ?? 'Tendencia'}: de ${fmt(first)} a ${fmt(last)}, mínimo ${fmt(Math.min(...props.values))}, máximo ${fmt(Math.max(...props.values))}`;
});
const last = computed(() => points.value.at(-1));
</script>

<template>
  <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="summary" class="overflow-visible" data-slot="sparkline">
    <path v-if="area && areaPath" :d="areaPath" :fill="color" fill-opacity="0.12" />
    <path v-if="line" :d="line" fill="none" :stroke="color" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    <circle v-if="last" :cx="last[0]" :cy="last[1]" r="2" :fill="color" />
  </svg>
</template>
