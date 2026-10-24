<script setup lang="ts">
import { ref } from 'vue';
import { Code } from '@lucide/vue';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#ui/components/ui/card';
import { Button } from '#ui/components/ui/button';
import { CodeBlock, CodeBlockContent } from '#ui/components/ui/code-block';

/** One catalog entry: live example plus the snippet to copy (no API calls in the catalog). */
defineProps<{ title: string; description?: string; code?: string; id?: string }>();
const showCode = ref(false);
</script>

<template>
  <Card :id="id" class="min-w-0 gap-4" data-slot="catalog-example">
    <CardHeader class="flex flex-row items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <CardTitle class="text-base">{{ title }}</CardTitle>
        <CardDescription v-if="description">{{ description }}</CardDescription>
      </div>
      <Button v-if="code" variant="ghost" size="sm" :aria-expanded="showCode" @click="showCode = !showCode"><Code class="size-4" aria-hidden="true" /> {{ showCode ? 'Ocultar código' : 'Ver código' }}</Button>
    </CardHeader>
    <CardContent class="min-w-0 space-y-4">
      <slot />
      <div v-if="code && showCode" class="relative">
        <CopyButton :value="code" icon-only label="Copiar código" variant="ghost" class="absolute top-2 right-2 z-10" />
        <CodeBlock size="sm"><CodeBlockContent class="max-h-80">{{ code }}</CodeBlockContent></CodeBlock>
      </div>
    </CardContent>
  </Card>
</template>
