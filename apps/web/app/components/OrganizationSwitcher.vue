<script setup lang="ts">
import { meSwitchOrganization } from '@starter/api-client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';

const me = useMe();
const notify = useNotify();
const current = computed({
  get: () => me.value?.organization.id ?? '',
  set: async (organizationId: string) => {
    try {
      await meSwitchOrganization({ client: useApi(), body: { organizationId } });
      await refreshMe();
      await refreshNuxtData();
    } catch (err) {
      notify.error(err);
    }
  },
});
</script>

<template>
  <Select v-if="(me?.organizations.length ?? 0) > 1" v-model="current">
    <SelectTrigger class="w-full group-data-[collapsible=icon]:hidden" aria-label="Organización activa" data-testid="org-switcher">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem v-for="o in me?.organizations" :key="o.id" :value="o.id">{{ o.name }}</SelectItem>
    </SelectContent>
  </Select>
</template>
