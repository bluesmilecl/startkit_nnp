<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight">{{ title }}</h1>
      <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2 sm:shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>
