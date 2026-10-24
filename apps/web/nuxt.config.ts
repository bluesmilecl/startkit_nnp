/**
 * Web app (Nuxt 4 + Nitro SSR). Business API and auth live in NestJS under the same origin:
 * - development: Nitro devProxy forwards /api to the API process (streaming preserved)
 * - Docker/production: the edge proxy (Caddy) routes /api to the API and pages to Nuxt
 * SSR calls the API through NUXT_API_INTERNAL_URL forwarding the user's cookies.
 */
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  extends: ['@starter/ui'],
  devtools: { enabled: false },
  ssr: true,
  components: [{ path: '~/components', pathPrefix: false }],
  typescript: { strict: true, typeCheck: false },
  app: {
    head: {
      htmlAttrs: { lang: 'es' },
      title: 'Starter Kit',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'light dark' },
      ],
      link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    },
  },
  runtimeConfig: {
    /** Server-only: API base URL reachable from the Nuxt server (SSR). */
    apiInternalUrl: 'http://localhost:3001',
    public: {
      appName: 'Starter Kit',
    },
  },
  nitro: {
    devProxy: {
      '/api': { target: 'http://localhost:3001/api', changeOrigin: false, ws: false },
    },
  },
  routeRules: {
    '/admin/**': { ssr: true },
  },
  vite: {
    optimizeDeps: {
      include: ['@lucide/vue', '@vueuse/core', 'better-auth/client/plugins', 'better-auth/vue', 'vue-input-otp', 'vue-sonner', 'zod', '@ai-sdk/vue', '@tanstack/vue-table'],
    },
  },
});
