import { createClient, createConfig, type Client } from '@starter/api-client';

/**
 * Typed REST client generated from the backend OpenAPI document.
 * - Browser: same-origin requests with the session cookie.
 * - SSR: calls NUXT_API_INTERNAL_URL forwarding cookies/forwarded headers and relays Set-Cookie
 *   (session refresh) back to the browser.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();
  let client: Client;
  if (import.meta.server) {
    const event = useRequestEvent();
    const incoming = useRequestHeaders(['cookie', 'user-agent', 'accept-language', 'x-forwarded-for', 'x-request-id']);
    const url = useRequestURL();
    client = createClient(
      createConfig({
        baseUrl: config.apiInternalUrl,
        throwOnError: true,
        headers: {
          ...incoming,
          'x-forwarded-host': url.host,
          'x-forwarded-proto': url.protocol.replace(':', ''),
        },
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const res = await fetch(input, init);
          const cookies = res.headers.getSetCookie?.() ?? [];
          if (event && cookies.length) for (const c of cookies) appendResponseHeader(event, 'set-cookie', c);
          return res;
        },
      }),
    );
  } else {
    client = createClient(createConfig({ baseUrl: '', credentials: 'include', throwOnError: true }));
    // Captured during plugin setup: interceptors run outside the Nuxt context.
    const me = useState('me');
    const router = useRouter();
    client.interceptors.response.use((response) => {
      if (response.status === 401 && me.value && !response.url.includes('/api/auth/')) {
        me.value = null;
        void nuxtApp.runWithContext(() => router.push({ path: '/session-expired', query: { redirect: router.currentRoute.value.fullPath } }));
      }
      return response;
    });
  }
  return { provide: { api: client } };
});
