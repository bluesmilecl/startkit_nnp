<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '#ui/components/ui/button';
import { normalizeError, type Problem } from '#ui/lib/errors';
import AppAlert from './AppAlert.vue';
import CopyButton from './CopyButton.vue';

/**
 * Inline error for data that could not be loaded: Spanish title and message from the error
 * catalog, the request id (copyable, to quote to support) and "Reintentar" when the failure is
 * transient and a `retry` listener exists.
 *
 *   const { data, problem, refresh, status } = await useApiData('orders', () => …);
 *   <LoadError v-if="problem" :error="problem" :retrying="status === 'pending'" @retry="refresh()" />
 */
const props = withDefaults(defineProps<{ error: unknown; title?: string; retrying?: boolean; onRetry?: () => unknown; testid?: string }>(), {
  title: undefined,
  retrying: false,
  onRetry: undefined,
  testid: 'load-error',
});
const problem = computed<Problem>(() => {
  const e = props.error as Partial<Problem> | null;
  // Already normalized (from useApiData) or anything thrown.
  return e && typeof e.title === 'string' && typeof e.status === 'number' && 'fieldErrors' in e ? (e as Problem) : normalizeError(props.error);
});
</script>

<template>
  <AppAlert variant="destructive" :title="title ?? problem.title" :data-testid="testid" :data-code="problem.code">
    <p>{{ problem.message }}</p>
    <p v-if="problem.requestId" class="mt-1 flex flex-wrap items-center gap-1 text-xs">
      Código de solicitud: <code class="font-mono" :data-testid="`${testid}-request-id`">{{ problem.requestId }}</code>
      <CopyButton :value="problem.requestId" label="Copiar código de solicitud" icon-only variant="ghost" size="icon-xs" />
    </p>
    <template v-if="onRetry && problem.retryable" #actions>
      <Button size="sm" variant="outline" :loading="retrying" :data-testid="`${testid}-retry`" @click="onRetry()">Reintentar</Button>
    </template>
  </AppAlert>
</template>
