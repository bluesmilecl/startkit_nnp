import { trustedOrigins, type Env } from '@starter/config';
import { and, eq, gt, sql, users, verifications, type Database } from '@starter/db';
import { otpEmail, type Mailer } from '@starter/mail';
import { createLogger, sanitizeError } from '@starter/observability';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP, openAPI } from 'better-auth/plugins';
import * as schema from '@starter/db/schema';
import { recordAudit } from './audit.js';
import { InvitationsService } from './invitations.js';
import { SettingsService } from './settings.js';
import type { FeatureFlags } from '@starter/config';

const log = createLogger('auth');

/**
 * Better Auth core routes not used by this starter (password, social, account linking, e-mail
 * change and self-deletion). Disabled so that every identity change goes through the audited
 * application services.
 */
export const DISABLED_AUTH_PATHS = [
  '/sign-up/email',
  '/sign-in/email',
  '/sign-in/social',
  '/callback/:id',
  '/change-password',
  '/set-password',
  '/change-email',
  '/update-user',
  '/delete-user',
  '/delete-user/callback',
  '/forget-password',
  '/reset-password',
  '/reset-password/:token',
  '/request-password-reset',
  '/verify-email',
  '/send-verification-email',
  '/link-social',
  '/unlink-account',
  '/list-accounts',
  '/account-info',
  '/refresh-token',
  '/get-access-token',
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/forget-password/email-otp',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
  '/email-otp/verify-email',
  '/verify-password',
  '/update-session',
];

export interface CreateAuthOptions {
  db: Database;
  env: Env;
  mailer: Mailer;
  features: FeatureFlags;
  /** Base path where the handler is mounted (must match the Express mount). */
  basePath?: string;
}

/**
 * Better Auth instance (email OTP only). Mounted in NestJS through `toNodeHandler` before the
 * JSON body parser. Identity tables are the single source of truth for users and sessions.
 */
export function createAuth({ db, env, mailer, features, basePath = '/api/auth' }: CreateAuthOptions) {
  const settings = new SettingsService({ db, env, mailer, features });
  const production = env.NODE_ENV === 'production';

  return betterAuth({
    appName: env.APP_NAME,
    baseURL: env.APP_URL,
    basePath,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(env),
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
    emailAndPassword: { enabled: false },
    disabledPaths: DISABLED_AUTH_PATHS,
    session: {
      expiresIn: env.SESSION_EXPIRES_DAYS * 86_400,
      updateAge: 86_400,
      // No cookie cache: revocations and disabled accounts take effect on the next request.
      cookieCache: { enabled: false },
      additionalFields: {
        activeOrganizationId: { type: 'string', required: false, input: false },
      },
    },
    user: {
      additionalFields: {
        disabledAt: { type: 'date', required: false, input: false },
        disabledReason: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, input: false },
        timezone: { type: 'string', required: false, input: false },
        lastLoginAt: { type: 'date', required: false, input: false },
      },
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: production, path: '/' },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    },
    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 5 },
        '/sign-in/email-otp': { window: 60, max: 10 },
      },
    },
    plugins: [
      emailOTP({
        otpLength: env.OTP_LENGTH,
        expiresIn: env.OTP_EXPIRES_SECONDS,
        allowedAttempts: env.OTP_MAX_ATTEMPTS,
        storeOTP: 'hashed',
        disableSignUp: false,
        rateLimit: { window: 60, max: 5 },
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'sign-in') return;
          try {
            const exists = await db
              .select({ id: users.id })
              .from(users)
              .where(sql`lower(${users.email}) = lower(${email})`)
              .limit(1);
            if (!exists.length) {
              const mode = (await settings.authSettings()).registration;
              // Same response for unknown e-mails (no enumeration), but nothing is sent.
              if (!(await InvitationsService.registrationAllowed(db, mode, email))) {
                log.info('otp requested for e-mail without access; not sent');
                return;
              }
            }
            const branding = await settings.branding();
            const tpl = otpEmail(
              { appName: branding.appName, primaryColor: branding.primaryColor, appUrl: env.APP_URL },
              otp,
              Math.round(env.OTP_EXPIRES_SECONDS / 60),
            );
            await mailer.send({ to: email, ...tpl, category: 'otp' });
          } catch (err) {
            log.error({ err: sanitizeError(err) }, 'otp e-mail failed');
            throw err;
          }
        },
      }),
      openAPI({ disableDefaultReference: true }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/email-otp/send-verification-otp' || env.OTP_RESEND_SECONDS <= 0) return;
        const email = String((ctx.body as { email?: string } | undefined)?.email ?? '').toLowerCase();
        if (!email) return;
        // expires_at is written once when the code is issued (created_at changes on failed attempts).
        const [recent] = await db
          .select({ expiresAt: verifications.expiresAt })
          .from(verifications)
          .where(and(eq(verifications.identifier, `sign-in-otp-${email}`), gt(verifications.expiresAt, new Date())))
          .limit(1);
        const sentAt = recent ? recent.expiresAt.getTime() - env.OTP_EXPIRES_SECONDS * 1000 : 0;
        const retryAfter = Math.ceil((sentAt + env.OTP_RESEND_SECONDS * 1000 - Date.now()) / 1000);
        if (recent && retryAfter > 0) {
          throw new APIError('TOO_MANY_REQUESTS', {
            message: `Espera ${retryAfter} segundos antes de solicitar otro código`,
            code: 'OTP_RESEND_COOLDOWN',
            retryAfter,
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            const mode = (await settings.authSettings()).registration;
            if (!(await InvitationsService.registrationAllowed(db, mode, user.email))) {
              throw new APIError('FORBIDDEN', { message: 'El registro no está permitido para este correo', code: 'REGISTRATION_CLOSED' });
            }
            return { data: { ...user, email: user.email.toLowerCase() } };
          },
          async after(user) {
            const mode = (await settings.authSettings()).registration;
            await InvitationsService.acceptPending(db, user, { defaultRole: mode === 'open' ? 'viewer' : null });
            await recordAudit(db, null, {
              action: 'users.register',
              resourceType: 'user',
              resourceId: user.id,
              outcome: 'success',
              metadata: { method: 'email-otp', registration: mode },
            });
          },
        },
      },
      session: {
        create: {
          async before(session) {
            const [u] = await db.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, session.userId)).limit(1);
            if (u?.disabledAt) {
              throw new APIError('FORBIDDEN', { message: 'La cuenta está desactivada', code: 'ACCOUNT_DISABLED' });
            }
          },
          async after(session) {
            const [u] = await db
              .update(users)
              .set({ lastLoginAt: new Date(), emailVerified: true })
              .where(eq(users.id, session.userId))
              .returning({ id: users.id, email: users.email });
            if (u) await InvitationsService.acceptPending(db, u);
            await recordAudit(db, null, {
              action: 'auth.login',
              resourceType: 'session',
              resourceId: session.id,
              outcome: 'success',
              actorUserId: session.userId,
              metadata: { userId: session.userId, ip: session.ipAddress ?? null },
            });
          },
        },
      },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
