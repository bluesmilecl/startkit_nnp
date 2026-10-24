<script setup lang="ts">
import { LayoutGrid, Table2 } from '@lucide/vue';
import { ToggleGroup, ToggleGroupItem } from '#ui/components/ui/toggle-group';
import type { ViewMode } from '#ui/lib/kit';

/** Table / cards switch for lists. Pair with useViewMode(key) and DataTable `view`. */
withDefaults(defineProps<{ testid?: string }>(), { testid: 'view-toggle' });
const model = defineModel<ViewMode>({ default: 'table' });
function onChange(v: unknown) {
  // A single toggle group can be emptied by clicking the active item: keep a value.
  if (v === 'table' || v === 'cards') model.value = v;
}
</script>

<template>
  <ToggleGroup type="single" variant="outline" size="sm" :model-value="model" aria-label="Forma de ver la lista" :data-testid="testid" @update:model-value="onChange">
    <ToggleGroupItem value="table" aria-label="Ver como tabla" :data-testid="`${testid}-table`"><Table2 class="size-4" aria-hidden="true" /></ToggleGroupItem>
    <ToggleGroupItem value="cards" aria-label="Ver como tarjetas" :data-testid="`${testid}-cards`"><LayoutGrid class="size-4" aria-hidden="true" /></ToggleGroupItem>
  </ToggleGroup>
</template>
