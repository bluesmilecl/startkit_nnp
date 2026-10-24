<script setup lang="ts">
import type { Component } from 'vue';
defineProps<{ title: string; description?: string; icon?: Component }>();
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center" role="status">
    <component :is="icon" v-if="icon" class="text-muted-foreground size-10" aria-hidden="true" />
    <div class="space-y-1">
      <p class="font-medium">{{ title }}</p>
      <p v-if="description" class="text-muted-foreground max-w-md text-sm">{{ description }}</p>
    </div>
    <slot />
  </div>
</template>
