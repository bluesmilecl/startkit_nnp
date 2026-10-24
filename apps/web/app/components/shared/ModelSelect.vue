<script setup lang="ts">
import { aiModelsList, type CatalogModel } from '@starter/api-client';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '#ui/components/ui/select';

/**
 * Selects an enabled catalog model of a function. Models not verified as available are shown but
 * labelled, so a selection never implies availability.
 */
const props = withDefaults(defineProps<{ fn?: 'chat' | 'embedding' | 'transcription'; placeholder?: string; allowNone?: boolean; id?: string; capability?: string }>(), { fn: 'chat', placeholder: 'Selecciona un modelo…', allowNone: false });
const model = defineModel<string | null>({ default: null });
const { data } = await useAsyncData(`model-select-${props.fn}-${props.capability ?? ''}`, () =>
  unwrap(aiModelsList({ client: useApi(), query: { function: props.fn, capability: props.capability, page: 1, pageSize: 100, sort: 'name' } })),
);
const groups = computed(() => {
  const out = new Map<string, CatalogModel[]>();
  for (const m of data.value?.items ?? []) {
    if (!m.enabled) continue;
    out.set(m.connectionAlias, [...(out.get(m.connectionAlias) ?? []), m]);
  }
  return [...out.entries()];
});
const value = computed({
  get: () => model.value ?? (props.allowNone ? '__none' : undefined),
  set: (v: string | undefined) => {
    model.value = !v || v === '__none' ? null : v;
  },
});
</script>

<template>
  <Select v-model="value">
    <SelectTrigger :id="id" class="w-full"><SelectValue :placeholder="placeholder" /></SelectTrigger>
    <SelectContent>
      <SelectItem v-if="allowNone" value="__none">Ninguno</SelectItem>
      <SelectGroup v-for="[alias, items] in groups" :key="alias">
        <SelectLabel>{{ alias }}</SelectLabel>
        <SelectItem v-for="m in items" :key="m.id" :value="m.id">{{ m.displayName ?? m.modelId }}{{ m.availability === 'available' ? '' : ' · sin verificar' }}</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</template>
