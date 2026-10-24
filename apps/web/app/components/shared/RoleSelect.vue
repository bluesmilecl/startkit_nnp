<script setup lang="ts">
import { adminRolesList, type RoleSummary } from '@starter/api-client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';

/** Role picker limited to roles the actor can assign (the server re-checks delegation). */
const props = withDefaults(defineProps<{ placeholder?: string; exclude?: string[]; id?: string; assignableOnly?: boolean }>(), {
  placeholder: 'Selecciona un rol',
  exclude: () => [],
  assignableOnly: true,
});
const model = defineModel<string | undefined>();
const me = useMe();
const { data: roles } = await useAsyncData('roles-select', () => unwrap(adminRolesList({ client: useApi() })), { default: () => [] as RoleSummary[] });
const myRank = computed(() => {
  const ids = new Set(me.value?.roles.map((r) => r.id));
  return Math.max(0, ...(roles.value ?? []).filter((r) => ids.has(r.id)).map((r) => r.rank));
});
const isOwner = computed(() => me.value?.roles.some((r) => r.key === 'owner') ?? false);
const options = computed(() =>
  (roles.value ?? []).filter(
    (r) => !props.exclude.includes(r.id) && (!props.assignableOnly || isOwner.value || (r.key !== 'owner' && r.rank < myRank.value)),
  ),
);
</script>

<template>
  <Select v-model="model">
    <SelectTrigger :id="id" class="w-full" data-testid="role-select"><SelectValue :placeholder="placeholder" /></SelectTrigger>
    <SelectContent>
      <SelectItem v-for="r in options" :key="r.id" :value="r.id" :data-testid="`role-option-${r.key}`">{{ r.name }}</SelectItem>
    </SelectContent>
  </Select>
</template>
