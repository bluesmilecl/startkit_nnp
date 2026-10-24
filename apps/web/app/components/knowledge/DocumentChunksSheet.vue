<script setup lang="ts">
import type { DocumentDetail } from '@starter/api-client';
import { Badge } from '#ui/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '#ui/components/ui/sheet';

/** Side panel with the indexed fragments of a document (active index version). */
const doc = defineModel<DocumentDetail | null>({ default: null });
</script>

<template>
  <Sheet :open="!!doc" @update:open="(v: boolean) => !v && (doc = null)">
    <SheetContent class="w-full overflow-y-auto sm:max-w-xl" data-testid="doc-chunks">
      <SheetHeader>
        <SheetTitle>{{ doc?.title ?? doc?.externalId }}</SheetTitle>
        <SheetDescription>
          {{ doc?.collectionName }} · {{ doc?.chunks.length }} fragmentos · versión {{ doc?.version }}
          <template v-if="doc?.sourceUrl"> · <a :href="doc.sourceUrl" target="_blank" rel="noopener noreferrer" class="underline">fuente</a></template>
        </SheetDescription>
        <div v-if="doc?.aclRoles.length" class="flex flex-wrap items-center gap-1 pt-1 text-xs">
          <span class="text-muted-foreground">Solo para:</span>
          <Badge v-for="r in doc.aclRoles" :key="r" variant="outline">{{ r }}</Badge>
        </div>
      </SheetHeader>
      <ol class="space-y-3 px-4 pb-6">
        <li v-for="c in doc?.chunks" :key="c.id" class="rounded-md border p-3 text-sm">
          <p class="text-muted-foreground mb-1 text-xs">
            #{{ c.ordinal + 1 }}<template v-if="c.heading"> · {{ c.heading }}</template><template v-if="c.page"> · página {{ c.page }}</template><template v-if="c.tokenCount"> · {{ c.tokenCount }} tokens</template>
          </p>
          <p class="whitespace-pre-wrap">{{ c.text }}</p>
        </li>
        <li v-if="doc && !doc.chunks.length" class="text-muted-foreground text-sm">El índice activo no tiene fragmentos de este documento.</li>
      </ol>
    </SheetContent>
  </Sheet>
</template>
