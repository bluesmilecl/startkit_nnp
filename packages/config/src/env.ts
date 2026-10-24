import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/**
 * Mail transports. `resend` is the recommended default; `smtp` works with your own server or any
 * provider's SMTP; the other APIs need only their key (docs/mail.md). `log` is development only.
 */
export const MAIL_TRANSPORTS = ['resend', 'smtp', 'postmark', 'sendgrid', 'mailgun', 'brevo', 'log'] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number];

/** Variables each transport needs (validated at startup, written by `starter mail use`). */
export const MAIL_TRANSPORT_KEYS: Record<MailTransport, string[]> = {
  resend: ['RESEND_API_KEY'],
  smtp: [],
  postmark: ['POSTMARK_SERVER_TOKEN'],
  sendgrid: ['SENDGRID_API_KEY'],
  mailgun: ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN'],
  brevo: ['BREVO_API_KEY'],
  log: [],
};

/**
 * Environment contract shared by api, worker, CLI and web (server side only).
 * Secrets are read here and never exported to client bundles.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  APP_NAME: z.string().default('Starter Kit'),
  /** Public origin users open in the browser (proxy entrypoint). */
  APP_URL: z.url().default('http://localhost:3000'),
  TRUSTED_ORIGINS: csv,
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3002),

  DATABASE_URL: z.string().min(1).default('postgres://starter:starter@localhost:5432/starter'),
  /** Optional privileged URL used only by the migrate service. */
  DATABASE_MIGRATION_URL: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  /** base64 encoded 32-byte key used to encrypt provider credentials at rest. */
  APP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must be 32 bytes encoded as base64'),
  /** Previous keys accepted for decryption during rotation (comma separated, base64). */
  APP_ENCRYPTION_PREVIOUS_KEYS: csv,

  OWNER_EMAIL: z.email().optional().or(z.literal('').transform(() => undefined)),
  REGISTRATION_MODE: z.enum(['open', 'invite-only', 'disabled']).default('invite-only'),
  OTP_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  OTP_EXPIRES_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  OTP_RESEND_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  /** Demo access (development and demos only): this e-mail always signs in with DEMO_LOGIN_CODE. */
  DEMO_LOGIN_EMAIL: z.email().transform((v) => v.toLowerCase()).optional(),
  DEMO_LOGIN_CODE: z.string().regex(/^\d+$/, 'only digits').default('111111'),
  SESSION_EXPIRES_DAYS: z.coerce.number().int().min(1).max(365).default(7),

  MAIL_TRANSPORT: z.enum(MAIL_TRANSPORTS).default('smtp'),
  MAIL_FROM: z.string().default('Starter Kit <no-reply@localhost>'),
  /** SMTP as a URL (smtp://user:pass@host:587) or, more comfortably, with the SMTP_HOST… fields. */
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** TLS from the first byte (port 465). Without it, STARTTLS is used when the server offers it. */
  SMTP_SECURE: bool.optional(),
  RESEND_API_KEY: z.string().optional(),
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MAILGUN_REGION: z.enum(['us', 'eu']).default('us'),
  BREVO_API_KEY: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage-data'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),

  FEATURE_ORGANIZATIONS: bool.default(false),
  FEATURE_AI: bool.default(true),
  FEATURE_RAG: bool.default(true),

  /** Enables the deterministic "test" AI provider. Never enable in production. */
  AI_TEST_PROVIDER_ENABLED: bool.default(false),
  /** Allow an SMTP server on a private network address in production (internal relay). */
  MAIL_ALLOW_PRIVATE_HOSTS: bool.default(false),
  /** Allow provider connections to private network endpoints (e.g. local Ollama). */
  AI_ALLOW_PRIVATE_ENDPOINTS: bool.default(false),
  MODEL_CATALOG_URL: z.url().default('https://models.dev/api.json'),
  FX_PROVIDER: z.enum(['none', 'mindicador']).default('none'),

  OPENAPI_DOCS: z.enum(['public', 'protected', 'disabled']).default('protected'),

  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  AUDIO_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  RAG_FETCH_ALLOW_PRIVATE: bool.default(false),
  RAG_FETCH_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

let cached: Env | undefined;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  // Empty variables behave as unset so that defaults apply (common with docker env files).
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    );
  }
  const env = result.data;
  if (env.NODE_ENV === 'production' && env.AI_TEST_PROVIDER_ENABLED) {
    throw new EnvValidationError([{ path: 'AI_TEST_PROVIDER_ENABLED', message: 'must be false in production' }]);
  }
  if (env.NODE_ENV === 'production' && env.DEMO_LOGIN_EMAIL) {
    throw new EnvValidationError([{ path: 'DEMO_LOGIN_EMAIL', message: 'a fixed demo code is not allowed in production' }]);
  }
  if (env.DEMO_LOGIN_EMAIL && env.DEMO_LOGIN_CODE.length !== env.OTP_LENGTH) {
    throw new EnvValidationError([{ path: 'DEMO_LOGIN_CODE', message: `must have OTP_LENGTH (${env.OTP_LENGTH}) digits` }]);
  }
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
    throw new EnvValidationError([{ path: 'S3_BUCKET', message: 'required when STORAGE_DRIVER=s3' }]);
  }
  if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT === 'log') {
    throw new EnvValidationError([{ path: 'MAIL_TRANSPORT', message: 'log transport would expose codes in logs; use resend, smtp or another provider' }]);
  }
  const missingMail = MAIL_TRANSPORT_KEYS[env.MAIL_TRANSPORT].filter((k) => !env[k as keyof typeof env]);
  if (missingMail.length) {
    throw new EnvValidationError(missingMail.map((k) => ({ path: k, message: `required when MAIL_TRANSPORT=${env.MAIL_TRANSPORT}` })));
  }
  return env;
}

/** Process-wide cached environment. */
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

export function trustedOrigins(env: Env): string[] {
  const origins = new Set<string>([new URL(env.APP_URL).origin, ...env.TRUSTED_ORIGINS]);
  return [...origins];
}
