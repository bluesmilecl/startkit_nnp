<script setup lang="ts">
import type { NuxtError } from '#app';
import { Button } from '#ui/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import type { IconName } from '#ui/lib/icons';
import { normalizeError } from '#ui/lib/errors';

/**
 * Full-page error (SSR and client): unknown routes, `useApiData(..., { fatal: [404] })` and
 * uncaught fatal errors. Shows the Spanish message from the error catalog and the request id;
 * never a stack trace outside development.
 */
const props = defineProps<{ error: NuxtError }>();

const problem = computed(() => normalizeError(props.error));
const status = computed(() => problem.value.status || 500);
const notFound = computed(() => status.value === 404);
const title = computed(() => (notFound.value && problem.value.code === 'NOT_FOUND' && !problem.value.requestId ? 'Página no encontrada' : problem.value.title));
const icon = computed<IconName>(() => (status.value === 404 ? 'search' : status.value === 401 || status.value === 403 ? 'locked' : 'error'));
const me = useState<unknown>('me');
const home = computed(() => (me.value ? '/admin' : '/'));
const devStack = import.meta.dev ? props.error.stack : undefined;

useHead({ title: title.value });
onMounted(() => {
  document.documentElement.dataset.hydrated = 'true';
});

function goHome() {
  void clearError({ redirect: home.value });
}
function retry() {
  // Reload the same URL from the server (the failure may have been transient).
  window.location.reload();
}
function back() {
  if (window.history.length > 1) window.history.back();
  else goHome();
}
</script>

<template>
  <NuxtLayout name="auth">
    <Card data-testid="error-page" :data-status="status" :data-code="problem.code">
      <CardHeader class="items-center text-center">
        <AppIcon :name="icon" class="text-muted-foreground mx-auto size-10" />
        <p class="text-muted-foreground text-sm font-medium tabular-nums">Error {{ status }}</p>
        <CardTitle class="text-xl" data-testid="error-title">{{ title }}</CardTitle>
        <CardDescription data-testid="error-message">{{ problem.message }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div v-if="problem.requestId" class="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2 text-xs">
          <span>Código de solicitud: <code class="font-mono" data-testid="error-request-id">{{ problem.requestId }}</code></span>
          <CopyButton :value="problem.requestId" label="Copiar código de solicitud" icon-only variant="ghost" size="icon-xs" />
        </div>
        <div class="flex flex-col gap-2">
          <Button v-if="status === 401" as-child><NuxtLink to="/login">Ingresar</NuxtLink></Button>
          <Button v-else data-testid="error-home" @click="goHome">Ir al inicio</Button>
          <div class="grid grid-cols-2 gap-2">
            <Button variant="outline" @click="back">Volver</Button>
            <Button variant="outline" :disabled="!problem.retryable" data-testid="error-retry" @click="retry">Reintentar</Button>
          </div>
        </div>
        <details v-if="devStack" class="text-muted-foreground text-xs">
          <summary class="cursor-pointer">Detalle técnico (solo en desarrollo)</summary>
          <pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{{ devStack }}</pre>
        </details>
      </CardContent>
    </Card>
  </NuxtLayout>
</template>
