<script setup lang="ts">
import type { Component } from 'vue';
import { Card, CardContent, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Skeleton } from '#ui/components/ui/skeleton';
defineProps<{ title: string; value?: string | number | null; hint?: string; icon?: Component; loading?: boolean }>();
</script>

<template>
  <Card class="gap-2">
    <CardHeader class="flex flex-row items-center justify-between pb-0">
      <CardTitle class="text-muted-foreground text-sm font-medium">{{ title }}</CardTitle>
      <component :is="icon" v-if="icon" class="text-muted-foreground size-4" aria-hidden="true" />
    </CardHeader>
    <CardContent>
      <Skeleton v-if="loading" class="h-8 w-24" />
      <div v-else class="text-2xl font-semibold tabular-nums">{{ value ?? '—' }}</div>
      <p v-if="hint" class="text-muted-foreground mt-1 text-xs">{{ hint }}</p>
    </CardContent>
  </Card>
</template>
