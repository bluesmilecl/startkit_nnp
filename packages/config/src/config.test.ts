import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './env.js';
import { SecretBox, isSecretRef, maskSecret, resolveSecretRef } from './secrets.js';
import { validateStarterConfig } from './starter-config.js';

const base = {
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('env', () => {
  it('applies defaults and treats empty values as unset', () => {
    const env = parseEnv({ ...base, DATABASE_MIGRATION_URL: '', OTP_LENGTH: '' });
    expect(env.OTP_LENGTH).toBe(6);
    expect(env.OTP_EXPIRES_SECONDS).toBe(300);
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
    expect(env.OTP_RESEND_SECONDS).toBe(60);
    expect(env.DATABASE_MIGRATION_URL).toBeUndefined();
  });

  it('rejects weak secrets and invalid keys', () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...base, APP_ENCRYPTION_KEY: 'abc' })).toThrow(/32 bytes/);
  });

  it('forbids the test AI provider and log mail transport in production', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', AI_TEST_PROVIDER_ENABLED: 'true' })).toThrow(/production/);
    expect(() => parseEnv({ ...base, NODE_ENV: 'production', MAIL_TRANSPORT: 'log' })).toThrow(/log transport/);
  });

  it('requires the keys of the chosen mail transport', () => {
    expect(() => parseEnv({ ...base, MAIL_TRANSPORT: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() => parseEnv({ ...base, MAIL_TRANSPORT: 'mailgun', MAILGUN_API_KEY: 'k' })).toThrow(/MAILGUN_DOMAIN/);
    expect(parseEnv({ ...base, MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'k' }).MAIL_TRANSPORT).toBe('brevo');
    expect(parseEnv({ ...base, SMTP_HOST: 'smtp.empresa.cl', SMTP_PORT: '465', SMTP_SECURE: 'true' })).toMatchObject({ SMTP_PORT: 465, SMTP_SECURE: true });
  });
});

describe('SecretBox', () => {
  const key = SecretBox.generateKey();
  it('encrypts with authenticated encryption and decrypts', () => {
    const box = new SecretBox(key);
    const env = box.encrypt('sk-test-123456');
    expect(env).toMatch(/^enc:v1:/);
    expect(env).not.toContain('sk-test');
    expect(box.decrypt(env)).toBe('sk-test-123456');
  });

  it('detects tampering', () => {
    const box = new SecretBox(key);
    const parts = box.encrypt('secret').split(':');
    parts[5] = Buffer.from('tampered').toString('base64');
    expect(() => box.decrypt(parts.join(':'))).toThrow();
  });

  it('supports key rotation through previous keys', () => {
    const old = new SecretBox(key);
    const envelope = old.encrypt('rotate-me');
    const next = new SecretBox(SecretBox.generateKey(), [key]);
    expect(next.decrypt(envelope)).toBe('rotate-me');
    expect(next.needsRotation(envelope)).toBe(true);
    expect(() => new SecretBox(SecretBox.generateKey()).decrypt(envelope)).toThrow(/unknown key/);
  });

  it('masks and resolves references', () => {
    expect(maskSecret('sk-abcdef1234')).toBe('••••1234');
    expect(isSecretRef('env:OPENAI_API_KEY')).toBe(true);
    expect(resolveSecretRef('env:FOO', { FOO: 'bar' })).toBe('bar');
    expect(() => resolveSecretRef('env:MISSING', {})).toThrow(/not set/);
  });
});

describe('starter.config.json', () => {
  const valid = { schemaVersion: 1, project: { name: 'Mi proyecto', locale: 'es-CL' } };
  it('accepts the documented example', () => {
    const r = validateStarterConfig({
      ...valid,
      features: { organizations: false, ai: true, rag: false },
      auth: { method: 'email-otp', registration: 'invite-only' },
      ai: { connectionRef: 'primary-ai', agent: { name: 'Asistente', modelRef: null, maxOutputTokens: 1200 } },
      rag: { mode: 'disabled' },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects secrets and connection strings', () => {
    const r = validateStarterConfig({ ...valid, project: { name: 'postgres://user:pass@host/db' } });
    expect(r.ok).toBe(false);
  });

  it('cross-validates RAG and microphone requirements', () => {
    const rag = validateStarterConfig({ ...valid, features: { rag: true, ai: true, organizations: false }, rag: { mode: 'internal' } });
    expect(rag.ok).toBe(false);
    if (!rag.ok) expect(rag.errors.some((e) => e.path === 'rag.embeddingProfileRef')).toBe(true);
    const mic = validateStarterConfig({ ...valid, ai: { agent: { microphone: { enabled: true } } } });
    expect(mic.ok).toBe(false);
    const disabledFeature = validateStarterConfig({ ...valid, rag: { mode: 'internal', embeddingProfileRef: 'p' } });
    expect(disabledFeature.ok).toBe(false);
  });
});
