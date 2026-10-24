export default defineNuxtPlugin(async () => {
  const branding = useBranding();
  if (import.meta.server || branding.value.appName === 'Starter Kit') await loadBranding();
});
