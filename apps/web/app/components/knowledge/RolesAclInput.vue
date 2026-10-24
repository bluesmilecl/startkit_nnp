<script setup lang="ts">
import { adminRolesList } from '@starter/api-client';
import { Checkbox } from '#ui/components/ui/checkbox';
import { Label } from '#ui/components/ui/label';

/** Role keys allowed to read (restricted visibility). */
const model = defineModel<string[]>({ default: () => [] });
const can = useCan();
const { data } = await useAsyncData('acl-roles', () => (can('roles.read') ? unwrap(adminRolesList({ client: useApi() })) : Promise.resolve([])));
function toggle(key: string, on: boolean) {
  const set = new Set(model.value);
  if (on) set.add(key);
  else set.delete(key);
  model.value = [...set];
}
</script>

<template>
  <div class="flex flex-wrap gap-3">
    <div v-for="r in data" :key="r.id" class="flex items-center gap-2">
      <Checkbox :id="`acl-${r.key}`" :model-value="model.includes(r.key)" @update:model-value="(v) => toggle(r.key, !!v)" />
      <Label :for="`acl-${r.key}`" class="text-sm font-normal">{{ r.name }}</Label>
    </div>
    <p v-if="!data?.length" class="text-muted-foreground text-xs">No tienes permiso para ver roles.</p>
  </div>
</template>
