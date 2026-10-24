import { ERROR_CATALOG } from '@starter/contracts';
import { createAuthClient } from 'better-auth/vue';
import { emailOTPClient } from 'better-auth/client/plugins';

let client: ReturnType<typeof make> | undefined;

function make() {
  return createAuthClient({
    baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
    basePath: '/api/auth',
    plugins: [emailOTPClient()],
  });
}

/** Better Auth Vue client (browser only): email OTP request/verification and sign out. */
export function authClient() {
  client ??= make();
  return client;
}

export function authErrorMessage(err: { code?: string; message?: string; status?: number } | null | undefined): string {
  switch (err?.code) {
    case 'INVALID_OTP':
      return 'El código no es válido. Revisa el correo e inténtalo nuevamente.';
    case 'OTP_EXPIRED':
      return 'El código venció. Solicita uno nuevo.';
    case 'TOO_MANY_ATTEMPTS':
      return 'Demasiados intentos incorrectos. Solicita un código nuevo.';
    case 'OTP_RESEND_COOLDOWN':
      return err.message ?? 'Espera antes de solicitar otro código.';
    case 'ACCOUNT_DISABLED':
      return 'Tu cuenta está desactivada. Contacta a un administrador.';
    case 'REGISTRATION_CLOSED':
      return 'Este correo no tiene acceso. Solicita una invitación.';
    default:
      // The auth rate limiter answers in English; show the catalog message instead.
      if (err?.status === 429) return ERROR_CATALOG.RATE_LIMITED.message;
      return err?.message ?? 'No se pudo completar la solicitud.';
  }
}
