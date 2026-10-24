<script setup lang="ts">
const props = defineProps<{ before: unknown; after: unknown }>();
const keys = computed(() => {
  const b = (props.before ?? {}) as Record<string, unknown>;
  const a = (props.after ?? {}) as Record<string, unknown>;
  if (typeof b !== 'object' || typeof a !== 'object') return [];
  return [...new Set([...Object.keys(b), ...Object.keys(a)])];
});
const fmt = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
</script>

<template>
  <table class="w-full text-sm">
    <thead>
      <tr class="text-muted-foreground text-left">
        <th class="py-1 pr-2 font-medium">Campo</th>
        <th class="py-1 pr-2 font-medium">Antes</th>
        <th class="py-1 font-medium">Después</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="k in keys" :key="k" class="border-t align-top">
        <td class="py-1 pr-2 font-mono text-xs">{{ k }}</td>
        <td class="py-1 pr-2 break-all text-red-700 dark:text-red-400">{{ fmt((before as Record<string, unknown>)?.[k]) }}</td>
        <td class="py-1 break-all text-green-700 dark:text-green-400">{{ fmt((after as Record<string, unknown>)?.[k]) }}</td>
      </tr>
      <tr v-if="!keys.length"><td colspan="3" class="text-muted-foreground py-2">Sin cambios registrados</td></tr>
    </tbody>
  </table>
</template>
