<script setup lang="ts">
import type { RagJob } from '@starter/api-client';
import { Progress } from '#ui/components/ui/progress';
import StatusBadge from '~/components/shared/StatusBadge.vue';

const props = defineProps<{ job: RagJob }>();
const STAGE: Record<string, string> = { fetch: 'Descargando', parse: 'Procesando', embed: 'Generando embeddings', write: 'Guardando', discover: 'Descubriendo', enqueue: 'Encolando', reindex: 'Reindexando', activate: 'Activando', delete: 'Eliminando', purge: 'Purgando', push: 'Enviando', unchanged: 'Sin cambios' };
const pct = computed(() => (props.job.progressTotal ? Math.min(100, (props.job.progressCurrent / props.job.progressTotal) * 100) : null));
const active = computed(() => ['running', 'retrying', 'queued'].includes(props.job.status));
const duration = computed(() => {
  if (active.value || !props.job.startedAt || !props.job.finishedAt) return null;
  const ms = new Date(props.job.finishedAt).getTime() - new Date(props.job.startedAt).getTime();
  return ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
});
</script>

<template>
  <div class="min-w-40 space-y-1" :data-status="job.status">
    <div class="flex items-center gap-2 text-xs">
      <StatusBadge :status="job.status" />
      <template v-if="active">
        <span class="text-muted-foreground">{{ job.stage ? (STAGE[job.stage] ?? job.stage) : '' }}</span>
        <span v-if="job.progressTotal" class="text-muted-foreground tabular-nums">{{ job.progressCurrent }}/{{ job.progressTotal }}</span>
      </template>
      <span v-else-if="duration" class="text-muted-foreground tabular-nums">en {{ duration }}</span>
    </div>
    <Progress v-if="active" :model-value="pct ?? undefined" class="h-1.5" :class="{ 'animate-pulse': pct === null }" :aria-label="`Progreso de ${job.kind}`" />
    <p v-if="job.error" class="text-destructive line-clamp-2 text-xs">{{ job.error }}</p>
  </div>
</template>
