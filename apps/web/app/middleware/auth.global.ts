const PUBLIC = new Set(['/login', '/verify', '/session-expired', '/forbidden']);

/**
 * Route guard (UI only): requires a session for private pages, sends owners to onboarding and
 * checks `definePageMeta({ permission })`. The API enforces the same rules server-side.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC.has(to.path)) return;
  const me = useMe();
  if (!me.value) await refreshMe();
  if (!me.value) {
    return navigateTo({ path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} });
  }
  if (me.value.onboardingRequired && to.path !== '/onboarding') return navigateTo('/onboarding');
  const permission = to.meta.permission as string | string[] | undefined;
  if (permission && !useCan()(permission)) {
    return navigateTo({ path: '/forbidden', query: { from: to.fullPath } });
  }
  const feature = to.meta.feature as 'ai' | 'rag' | 'organizations' | undefined;
  if (feature && !me.value.features[feature]) return navigateTo({ path: '/forbidden', query: { from: to.fullPath, reason: 'feature' } });
});
