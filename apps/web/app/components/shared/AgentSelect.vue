<script setup lang="ts">
import { aiAgentsList } from '@starter/api-client';
import { Input } from '#ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#ui/components/ui/select';

/** Agent selector; without ai.agents.manage the agent id is typed instead of listed. */
const model = defineModel<string>({ default: '' });
defineProps<{ id?: string }>();
const can = useCan();
const { data } = await useAsyncData('agent-select', () => (can('ai.agents.manage') ? unwrap(aiAgentsList({ client: useApi() })) : Promise.resolve(null)));
</script>

<template>
  <ClientOnly v-if="data">
    <template #fallback><div class="border-input h-9 w-full rounded-md border" aria-hidden="true" /></template>
    <Select v-model="model">
      <SelectTrigger :id="id" class="w-full"><SelectValue placeholder="Selecciona un agente…" /></SelectTrigger>
      <SelectContent><SelectItem v-for="a in data" :key="a.id" :value="a.id">{{ a.name }}</SelectItem></SelectContent>
    </Select>
  </ClientOnly>
  <Input v-else :id="id" v-model="model" placeholder="ID del agente" />
</template>
