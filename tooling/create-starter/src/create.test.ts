import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAIL_TRANSPORTS } from '@starter/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installationEnv, MAIL_CHOICES, renderEnv, resolveMail } from './commands/create.js';
import { init } from './commands/init.js';
import { mailUse } from './commands/mail.js';

describe('create: .env rendering', () => {
  it('fills known keys in place, quotes values with spaces and appends missing keys', () => {
    const out = renderEnv('# comment\nAPP_NAME="Starter Kit"\nBETTER_AUTH_SECRET=change-me\nOWNER_EMAIL=\n', { APP_NAME: 'Mesa de Ayuda', BETTER_AUTH_SECRET: 'abc123', OWNER_EMAIL: 'a@b.cl', EXTRA: 'x' });
    expect(out).toBe('# comment\nAPP_NAME="Mesa de Ayuda"\nBETTER_AUTH_SECRET=abc123\nOWNER_EMAIL=a@b.cl\n\nEXTRA=x');
  });
});

describe('installation values', () => {
  const base = { name: 'Mesa', owner: 'a@b.cl', modules: new Set(['ai']), db: 'docker' as const, databaseUrl: '', mail: 'smtp' as const };

  it('mail: same transports as the env contract; auto prefers Resend when its key exists', () => {
    expect([...MAIL_CHOICES]).toEqual([...MAIL_TRANSPORTS]);
    expect(resolveMail('auto', { RESEND_API_KEY: 're_1' })).toBe('resend');
    expect(resolveMail(undefined, {})).toBe('smtp');
    expect(resolveMail('Brevo', {})).toBe('brevo');
    expect(() => resolveMail('mandrill', {})).toThrow(/desconocido/);
    expect(installationEnv({ ...base, mail: 'resend' }).MAIL_FROM).toBe('Mesa <onboarding@resend.dev>');
  });

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

describe('starter init --new (project based on the starter)', () => {
  function clone() {
    const dir = mkdtempSync(join(tmpdir(), 'starter-new-'));
    writeFileSync(join(dir, 'starter.manifest.json'), '{"version":"0.1.0"}');
    writeFileSync(join(dir, 'package.json'), '{"name":"starter-kit","version":"0.1.0","private":true}');
    writeFileSync(join(dir, 'starter.config.json'), '{"project":{"name":"Starter Kit"}}');
    writeFileSync(join(dir, '.env.example'), 'APP_NAME="Starter Kit"\nOWNER_EMAIL=\nSMTP_URL=smtp://localhost:1025\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\n@AGENTS.md\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/bluesmilecl/startkit_nnp.git'], { cwd: dir });
    return dir;
  }
  const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

  it('renames the package, isolates Docker, keeps the starter as a remote and writes PROJECT.md', async () => {
    const dir = clone();
    expect(await init({ cwd: dir, owner: 'duena@empresa.cl', newProject: 'Mesa de Ayuda', mail: 'smtp', mailpitPort: '8026', mailpitSmtpPort: '1026' })).toBe(0);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    expect(env).toMatch(/^APP_NAME="Mesa de Ayuda"$/m);
    expect(env).toMatch(/^COMPOSE_PROJECT_NAME=mesa-de-ayuda$/m);
    expect(env).toMatch(/^MAILPIT_PORT=8026$/m);
    expect(env).toMatch(/^SMTP_URL=smtp:\/\/localhost:1026$/m);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).toMatchObject({ name: 'mesa-de-ayuda', version: '0.1.0', private: true });
    expect(JSON.parse(readFileSync(join(dir, 'starter.config.json'), 'utf8'))).toMatchObject({ project: { name: 'Mesa de Ayuda', slug: 'mesa-de-ayuda' } });
    expect(git(dir, 'remote')).toBe('starter');

    const context = readFileSync(join(dir, 'PROJECT.md'), 'utf8');
    expect(context).toMatch(/^# Mesa de Ayuda$/m);
    expect(context).toContain('`duena@empresa.cl`');
    expect(context).toContain('<!-- modules: el generador agrega una fila por módulo -->');
    expect(context).not.toMatch(/SECRET|postgres:\/\//);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# CLAUDE.md\n\n@PROJECT.md\n@AGENTS.md\n');

    // Re-running (the quickstart is idempotent) changes nothing.
    writeFileSync(join(dir, 'PROJECT.md'), `${context}\nNotas propias\n`);
    expect(await init({ cwd: dir, owner: 'duena@empresa.cl', newProject: 'Mesa de Ayuda' })).toBe(0);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(env);
    expect(readFileSync(join(dir, 'PROJECT.md'), 'utf8')).toContain('Notas propias');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8').match(/@PROJECT\.md/g)).toHaveLength(1);
  });

  it('clones of the derived project keep its name and Docker project without --new', async () => {
    const dir = clone();
    writeFileSync(join(dir, 'starter.config.json'), '{"project":{"name":"Mesa de Ayuda","slug":"mesa-de-ayuda"}}');
    expect(await init({ cwd: dir, owner: 'colega@empresa.cl' })).toBe(0);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    expect(env).toMatch(/^APP_NAME="Mesa de Ayuda"$/m);
    expect(env).toMatch(/^COMPOSE_PROJECT_NAME=mesa-de-ayuda$/m);
    expect(readFileSync(join(dir, 'starter.config.json'), 'utf8')).toBe('{"project":{"name":"Mesa de Ayuda","slug":"mesa-de-ayuda"}}');
  });

  it('adopts an already installed clone without touching its secrets', async () => {
    const dir = clone();
    expect(await init({ cwd: dir, owner: 'duena@empresa.cl' })).toBe(0);
    expect(existsSync(join(dir, 'PROJECT.md'))).toBe(false);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    expect(await init({ cwd: dir, newProject: 'Mesa de Ayuda' })).toBe(0);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(env);
    expect(readFileSync(join(dir, 'PROJECT.md'), 'utf8')).toContain('`duena@empresa.cl`');
    expect(git(dir, 'remote')).toBe('starter');
  });
});

describe('starter mail use', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });
  function project(env: string) {
    const dir = mkdtempSync(join(tmpdir(), 'starter-mail-'));
    writeFileSync(join(dir, 'starter.manifest.json'), '{}');
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, '.env'), env);
    return dir;
  }
  const secrets = `BETTER_AUTH_SECRET=${'x'.repeat(40)}\nAPP_ENCRYPTION_KEY=${Buffer.alloc(32, 1).toString('base64')}\nAPP_NAME="Mesa de Ayuda"\nMAIL_TRANSPORT=smtp\nMAIL_FROM="Mesa de Ayuda <no-reply@localhost>"\n`;

  it('switches to Resend with the key from the shell and the test sender', async () => {
    const dir = project(secrets);
    process.env.RESEND_API_KEY = 're_from_shell';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    expect(await mailUse('resend', { cwd: dir })).toBe(0);
    const env = readFileSync(join(dir, '.env'), 'utf8');
    expect(env).toMatch(/^MAIL_TRANSPORT=resend$/m);
    expect(env).toMatch(/^RESEND_API_KEY=re_from_shell$/m);
    expect(env).toContain('MAIL_FROM="Mesa de Ayuda <onboarding@resend.dev>"');
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
  });

  it('refuses an incomplete provider and leaves .env untouched', async () => {
    const dir = project(secrets);
    delete process.env.MAILGUN_DOMAIN;
    process.env.MAILGUN_API_KEY = 'k';
    expect(await mailUse('mailgun', { cwd: dir })).toBe(1);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(secrets);
  });
});
