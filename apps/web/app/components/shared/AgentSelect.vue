<script setup lang="ts">
import { Input } from '#ui/components/ui/input';

/** Agent selector (replaced by the agents list once the agents module is wired). */
const model = defineModel<string>({ default: '' });
</script>

<template>
  <Input v-model="model" placeholder="ID del agente" />
</template>
