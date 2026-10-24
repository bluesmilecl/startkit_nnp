<script setup lang="ts">
import { Badge } from '#ui/components/ui/badge';
defineProps<{ roles: { id: string; name: string; organizationId?: string | null }[] }>();
</script>

<template>
  <span class="flex flex-wrap gap-1">
    <Badge v-for="r in roles" :key="r.id + (r.organizationId ?? '')" variant="secondary">{{ r.name }}</Badge>
    <span v-if="!roles.length" class="text-muted-foreground text-xs">Sin roles</span>
  </span>
</template>
