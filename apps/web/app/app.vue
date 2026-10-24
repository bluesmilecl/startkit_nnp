<script setup lang="ts">
import 'vue-sonner/style.css';
import { Toaster } from '#ui/components/ui/sonner';

import { setFormatLocale } from '#ui/lib/format';

const branding = useBranding();
watchEffect(() => setFormatLocale(branding.value.locale, branding.value.timeZone));
// Marker used by E2E tests (and CSS) to know the client app is interactive.
onMounted(() => {
  document.documentElement.dataset.hydrated = 'true';
});
useHead({
  htmlAttrs: { lang: computed(() => branding.value.locale) },
  titleTemplate: (t) => (t ? `${t} · ${branding.value.appName}` : branding.value.appName),
  style: [{ key: 'brand', textContent: computed(() => `:root{--brand:${branding.value.primaryColor}}`) }],
});
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ConfirmHost />
  <Toaster rich-colors close-button position="top-right" />
</template>
