<script setup lang="ts">
const branding = useBranding();
</script>

<template>
  <div class="bg-muted/40 flex min-h-svh flex-col items-center justify-center gap-6 p-4 sm:p-8">
    <div class="flex items-center gap-2 font-semibold">
      <img v-if="branding.logoUrl" :src="branding.logoUrl" alt="" class="size-8 rounded" />
      <span v-else class="flex size-8 items-center justify-center rounded-md text-white" :style="{ background: branding.primaryColor }" aria-hidden="true">
        {{ branding.appName.slice(0, 1) }}
      </span>
      <span>{{ branding.appName }}</span>
    </div>
    <main class="w-full max-w-sm">
      <slot />
    </main>
  </div>
</template>
