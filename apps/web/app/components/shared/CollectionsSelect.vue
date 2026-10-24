<script setup lang="ts">
import { ragCollectionsList } from '@starter/api-client';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Label } from '#ui/components/ui/label';

/** Knowledge collections of the organization (multi-select). */
const model = defineModel<string[]>({ default: () => [] });
const api = useApi();
const { data, error } = await useAsyncData('collections-select', () => unwrap(ragCollectionsList({ client: api, query: { page: 1, pageSize: 100 } })).then((r) => r.items.filter((c) => c.status !== 'deleting')), { default: () => [] });
function toggle(id: string, on: boolean) {
  const set = new Set(model.value);
  if (on) set.add(id);
  else set.delete(id);
  model.value = [...set];
}
</script>

<template>
  <div class="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
    <div v-for="c in data" :key="c.id" class="flex items-center gap-2">
      <Checkbox :id="`col-${c.id}`" :model-value="model.includes(c.id)" @update:model-value="(v) => toggle(c.id, !!v)" />
      <Label :for="`col-${c.id}`" class="text-sm font-normal">{{ c.name }}</Label>
      <span class="text-muted-foreground text-xs">{{ c.connection.kind === 'api' ? 'API externa' : `${c.stats.indexed} doc.` }}{{ c.status === 'paused' ? ' · pausada' : '' }}</span>
    </div>
    <p v-if="!data?.length" class="text-muted-foreground p-2 text-sm">{{ error ? 'No se pudieron cargar las colecciones' : 'No hay colecciones. Créalas en Conocimiento → Colecciones.' }}</p>
  </div>
</template>
