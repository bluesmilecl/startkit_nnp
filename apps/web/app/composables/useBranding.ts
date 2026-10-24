import { publicSettings, type PublicSettings } from '@starter/api-client';

const fallback: PublicSettings = {
  appName: 'Starter Kit',
  logoUrl: null,
  primaryColor: '#2563eb',
  locale: 'es-CL',
  timeZone: 'America/Santiago',
  registration: 'invite-only',
  otpLength: 6,
  otpResendSeconds: 60,
  demoLogin: null,
};

export function useBranding() {
  return useState<PublicSettings>('branding', () => fallback);
}

export async function loadBranding(): Promise<PublicSettings> {
  const state = useBranding();
  try {
    state.value = (await unwrap(publicSettings({ client: useApi() }))) ?? fallback;
  } catch {
    /* API not reachable: keep defaults, pages show their own errors */
  }
  return state.value;
}
