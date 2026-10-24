<script setup lang="ts">
import { Search, X } from '@lucide/vue';
import { Input } from '#ui/components/ui/input';
import { Button } from '#ui/components/ui/button';
import type { ViewMode } from '#ui/lib/kit';
import ViewToggle from './ViewToggle.vue';

/**
 * Toolbar above a list: search box, filters (slot), "Limpiar" when something is filtered, view
 * toggle and actions (slot). Bind `v-model:search` to useListQuery's debounced `search`.
 *
 *   <DataToolbar v-model:search="list.search.value" v-model:view="view" placeholder="Buscar clientes"
 *     :filtered="list.filtered.value" @clear="list.reset()">
 *     <template #filters><Select v-model="status">…</Select></template>
 *     <template #actions><Button>Exportar</Button></template>
 *   </DataToolbar>
 *
 * Omit `v-model:view` to hide the table/cards toggle.
 */
withDefaults(defineProps<{ placeholder?: string; searchLabel?: string; filtered?: boolean; testid?: string }>(), {
  placeholder: 'Buscar',
  searchLabel: undefined,
  filtered: false,
  testid: 'toolbar',
});
const search = defineModel<string>('search');
const view = defineModel<ViewMode>('view');
const emit = defineEmits<{ clear: [] }>();
</script>

<template>
  <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" role="search" :data-testid="testid">
    <div v-if="search !== undefined" class="relative min-w-0 flex-1 sm:min-w-56">
      <Search class="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" aria-hidden="true" />
      <Input v-model="search" type="search" :placeholder="placeholder" :aria-label="searchLabel ?? placeholder" class="pl-8" :data-testid="`${testid}-search`" />
    </div>
    <div v-if="$slots.filters" class="flex flex-wrap items-center gap-2"><slot name="filters" /></div>
    <Button v-if="filtered" variant="ghost" size="sm" :data-testid="`${testid}-clear`" @click="emit('clear')"><X class="size-4" aria-hidden="true" /> Limpiar</Button>
    <div class="flex items-center gap-2 sm:ml-auto">
      <slot name="actions" />
      <ViewToggle v-if="view !== undefined" v-model="view" :testid="`${testid}-view`" />
    </div>
  </div>
</template>
