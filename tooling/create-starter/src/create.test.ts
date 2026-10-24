import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installationEnv, renderEnv } from './commands/create.js';
import { init } from './commands/init.js';

describe('create: .env rendering', () => {
  it('fills known keys in place, quotes values with spaces and appends missing keys', () => {
    const out = renderEnv('# comment\nAPP_NAME="Starter Kit"\nBETTER_AUTH_SECRET=change-me\nOWNER_EMAIL=\n', { APP_NAME: 'Mesa de Ayuda', BETTER_AUTH_SECRET: 'abc123', OWNER_EMAIL: 'a@b.cl', EXTRA: 'x' });
    expect(out).toBe('# comment\nAPP_NAME="Mesa de Ayuda"\nBETTER_AUTH_SECRET=abc123\nOWNER_EMAIL=a@b.cl\n\nEXTRA=x');
  });
});

describe('installation values', () => {
  const base = { name: 'Mesa', owner: 'a@b.cl', modules: new Set(['ai']), db: 'docker' as const, databaseUrl: '', mail: 'smtp' as const };

  it('generates unique secrets and points the URLs at the chosen PostgreSQL port', () => {
    const a = installationEnv(base);
    const b = installationEnv({ ...base, pgPort: 5433, testAi: true });
    expect(a.BETTER_AUTH_SECRET).toHaveLength(64);
    expect(Buffer.from(a.APP_ENCRYPTION_KEY!, 'base64')).toHaveLength(32);
    expect(a.BETTER_AUTH_SECRET).not.toBe(b.BETTER_AUTH_SECRET);
    expect(a.DATABASE_URL).toContain('@localhost:5432/');
    expect(b).toMatchObject({ POSTGRES_PORT: '5433', AI_TEST_PROVIDER_ENABLED: 'true', FEATURE_RAG: 'false' });
    expect(b.DATABASE_URL).toContain('@localhost:5433/');
  });
});

describe('starter init (current clone)', () => {
  function project() {
    const dir = mkdtempSync(join(tmpdir(), 'starter-init-'));
    writeFileSync(join(dir, 'starter.manifest.json'), '{}');
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, '.env.example'), 'BETTER_AUTH_SECRET=change-me\nOWNER_EMAIL=\nDATABASE_URL=\n');
    return dir;
  }

  it('writes .env (600) and starter.config.json, and never overwrites secrets on re-run', async () => {
    const dir = project();
    await expect(init({ cwd: dir })).rejects.toThrow(/--owner/);
    expect(await init({ cwd: dir, owner: 'Duena@Empresa.cl', modules: 'ai,rag' })).toBe(0);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    expect(env).toMatch(/^OWNER_EMAIL=duena@empresa\.cl$/m);
    expect(env).not.toContain('change-me');
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dir, 'starter.config.json'), 'utf8'))).toMatchObject({ features: { ai: true, rag: true }, project: { ownerEmail: 'duena@empresa.cl' } });
    expect(readFileSync(join(dir, 'starter.config.json'), 'utf8')).not.toMatch(/postgres:|SECRET/);

    await init({ cwd: dir, owner: 'otra@empresa.cl' });
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(env);
  });

  it('fills an empty OWNER_EMAIL of an existing .env', async () => {
    const dir = project();
    writeFileSync(join(dir, '.env'), 'BETTER_AUTH_SECRET=propio\nOWNER_EMAIL=\n');
    await init({ cwd: dir, owner: 'a@b.cl' });
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('BETTER_AUTH_SECRET=propio\nOWNER_EMAIL=a@b.cl\n');
  });
});
