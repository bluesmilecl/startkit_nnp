import { meGet, type Me } from '@starter/api-client';

/** Current user, organization, roles and effective permissions (fetched from /api/me). */
export function useMe() {
  return useState<Me | null>('me', () => null);
}

export async function refreshMe(): Promise<Me | null> {
  const me = useMe();
  try {
    me.value = await unwrap(meGet({ client: useApi() }));
  } catch (err) {
    if (apiError(err).code === 'UNAUTHENTICATED' || apiError(err).code === 'FORBIDDEN') me.value = null;
    else throw err;
  }
  return me.value;
}

/** UI hint only: the server enforces every permission again. */
export function useCan() {
  const me = useMe();
  return (permission: string | string[]) => {
    const perms = me.value?.permissions ?? [];
    return [permission].flat().every((p) => perms.includes(p));
  };
}

export async function signOut(): Promise<void> {
  await $fetch('/api/auth/sign-out', { method: 'POST', body: {}, credentials: 'include' }).catch(() => undefined);
  useMe().value = null;
  await navigateTo('/login');
}
