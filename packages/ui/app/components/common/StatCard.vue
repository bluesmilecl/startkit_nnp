<script setup lang="ts">
import { computed, type Component } from 'vue';
import { TrendingDown, TrendingUp } from '@lucide/vue';
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Skeleton } from '#ui/components/ui/skeleton';
import { formatPercentChange } from '#ui/lib/format';
import Sparkline from '../charts/Sparkline.vue';

/**
 * Indicator: title, value, hint and icon; optional `trend` (relative change, 0.12 = +12 %) and
 * `sparkline` values. `invertTrend` when lower is better (costs, errors, latency).
 *
 *   <StatCard title="Costo del mes" :value="formatUsd(cost)" :trend="-0.08" invert-trend :sparkline="daily" :icon="ICONS.money" />
 */
const props = defineProps<{ title: string; value?: string | number | null; hint?: string; icon?: Component; loading?: boolean; trend?: number | null; trendLabel?: string; invertTrend?: boolean; sparkline?: number[] }>();
const trendText = computed(() => (props.trend === null || props.trend === undefined ? null : formatPercentChange(props.trend)));
const good = computed(() => (props.trend ?? 0) === 0 ? null : ((props.trend ?? 0) > 0) !== !!props.invertTrend);
</script>

<template>
  <Card class="gap-2">
    <CardHeader class="flex flex-row items-center justify-between pb-0">
      <CardTitle class="text-muted-foreground text-sm font-medium">{{ title }}</CardTitle>
      <component :is="icon" v-if="icon" class="text-muted-foreground size-4" aria-hidden="true" />
    </CardHeader>
    <CardContent>
      <Skeleton v-if="loading" class="h-8 w-24" />
      <div v-else class="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div class="text-2xl font-semibold whitespace-nowrap tabular-nums">{{ value ?? '—' }}</div>
        <Sparkline v-if="sparkline?.length" :values="sparkline" :label="title" />
      </div>
      <p v-if="trendText || hint" class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 text-xs">
        <span v-if="trendText" class="inline-flex items-center gap-1 font-medium" :class="good === null ? undefined : good ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'" data-slot="trend">
          <TrendingUp v-if="(trend ?? 0) > 0" class="size-3" aria-hidden="true" /><TrendingDown v-else-if="(trend ?? 0) < 0" class="size-3" aria-hidden="true" />{{ trendText }}
        </span>
        <span v-if="trendLabel && trendText">{{ trendLabel }}</span>
        <span v-if="hint">{{ hint }}</span>
      </p>
    </CardContent>
  </Card>
</template>
