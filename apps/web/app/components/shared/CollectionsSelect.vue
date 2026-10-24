<script setup lang="ts">
import { Checkbox } from '#ui/components/ui/checkbox';
import { Label } from '#ui/components/ui/label';

/** Knowledge collections of the organization (multi-select). */
const model = defineModel<string[]>({ default: () => [] });
interface CollectionOption {
  id: string;
  name: string;
  status: string;
  documentCount?: number;
}
const { data, error } = await useAsyncData('collections-select', () => $fetch<{ items: CollectionOption[] }>('/api/rag/collections', { query: { pageSize: 100 } }).then((r) => r.items), { default: () => [] });
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
      <span v-if="c.documentCount !== undefined" class="text-muted-foreground text-xs">{{ c.documentCount }} doc.</span>
    </div>
    <p v-if="!data?.length" class="text-muted-foreground p-2 text-sm">{{ error ? 'No se pudieron cargar las colecciones' : 'No hay colecciones. Créalas en Conocimiento → Colecciones.' }}</p>
  </div>
</template>
