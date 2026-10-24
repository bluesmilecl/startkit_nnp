<script setup lang="ts">
import type { Permission } from '@starter/api-client';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Badge } from '#ui/components/ui/badge';
import { Label } from '#ui/components/ui/label';

const props = defineProps<{ permissions: Permission[]; disabled?: boolean; grantable?: (key: string) => boolean }>();
const model = defineModel<string[]>({ default: () => [] });
const GROUP_LABELS: Record<string, string> = {
  users: 'Usuarios',
  roles: 'Roles y permisos',
  organizations: 'Organizaciones',
  settings: 'Configuración',
  audit: 'Auditoría',
  system: 'Sistema',
  ai: 'Inteligencia artificial',
  rag: 'Conocimiento (RAG)',
  projects: 'Proyectos',
};
const groups = computed(() => {
  const map = new Map<string, Permission[]>();
  for (const p of props.permissions) map.set(p.group, [...(map.get(p.group) ?? []), p]);
  return [...map.entries()];
});
function toggle(key: string, on: boolean | 'indeterminate') {
  const set = new Set(model.value);
  if (on === true) set.add(key);
  else set.delete(key);
  model.value = [...set].sort();
}
</script>

<template>
  <div class="grid gap-6 md:grid-cols-2">
    <fieldset v-for="[group, perms] in groups" :key="group" class="space-y-2">
      <legend class="mb-1 text-sm font-semibold">{{ GROUP_LABELS[group] ?? group }}</legend>
      <div v-for="p in perms" :key="p.key" class="flex items-start gap-2">
        <Checkbox
          :id="`perm-${p.key}`"
          :model-value="model.includes(p.key)"
          :disabled="disabled || (grantable ? !grantable(p.key) && !model.includes(p.key) : false)"
          :data-testid="`perm-${p.key}`"
          @update:model-value="toggle(p.key, $event)"
        />
        <Label :for="`perm-${p.key}`" class="flex flex-col items-start gap-0.5 font-normal">
          <span class="font-mono text-xs">{{ p.key }} <Badge v-if="p.sensitive" variant="outline" class="ml-1 text-[10px]">sensible</Badge></span>
          <span class="text-muted-foreground text-xs">{{ p.description }}</span>
        </Label>
      </div>
    </fieldset>
  </div>
</template>
