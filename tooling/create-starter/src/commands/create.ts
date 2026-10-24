import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { ask, c, choose, CliError, confirm, line, title } from '../lib/ui.js';

/** Never copied from the template: VCS data, dependencies, builds, local data and secrets. */
const EXCLUDE = new Set(['.git', 'node_modules', 'dist', '.nuxt', '.output', 'test-results', 'playwright-report', 'storage-data', '.env', '.env.e2e', 'verify-report.md', '.turbo', 'coverage']);

export interface CreateOptions {
  dir?: string;
  from?: string;
  ref?: string;
  name?: string;
  owner?: string;
  modules?: string;
  db?: string;
  databaseUrl?: string;
  mail?: string;
  yes?: boolean;
  install?: boolean;
  git?: boolean;
}

const secret = (bytes: number, enc: 'hex' | 'base64') => randomBytes(bytes).toString(enc);
const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'mi-app';

function defaultTemplate(): string {
  if (process.env.STARTER_TEMPLATE) return process.env.STARTER_TEMPLATE;
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { starter?: { templateRepository?: string } };
  return pkg.starter?.templateRepository ?? '';
}

/** Copies the template (local directory or git repository) into `target`. */
function fetchTemplate(from: string, target: string, ref?: string): void {
  let source = resolve(from);
  let cleanup: string | null = null;
  if (!existsSync(source)) {
    cleanup = mkdtempSync(join(tmpdir(), 'starter-template-'));
    const args = ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), from, cleanup];
    const r = spawnSync('git', args, { stdio: 'inherit' });
    if (r.status !== 0) throw new CliError(`No se pudo clonar la plantilla ${from}`);
    source = cleanup;
  }
  if (!existsSync(join(source, 'starter.manifest.json'))) throw new CliError(`${from} no es una plantilla del starter (falta starter.manifest.json)`);
  try {
    cpSync(source, target, {
      recursive: true,
      filter: (src) => {
        const rel = relative(source, src);
        return !rel || !rel.split(/[\\/]/).some((part) => EXCLUDE.has(part) || part.endsWith('.tsbuildinfo'));
      },
    });
  } finally {
    if (cleanup) rmSync(cleanup, { recursive: true, force: true });
  }
}

/** Fills .env from the template's .env.example with per-installation secrets. */
export function renderEnv(example: string, values: Record<string, string>): string {
  const seen = new Set<string>();
  const out = example.split('\n').map((l) => {
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(l);
    if (!m || !(m[1]! in values)) return l;
    seen.add(m[1]!);
    const v = values[m[1]!]!;
    return `${m[1]}=${/[\s#"]/.test(v) ? JSON.stringify(v) : v}`;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}=${v}`);
  return out.join('\n');
}

export async function create(opts: CreateOptions): Promise<void> {
  title('Starter Kit Nuxt + NestJS IA · nueva instalación');
  const name = opts.name ?? (await ask('Nombre de la aplicación', opts.dir ? basename(resolve(opts.dir)) : 'Mi aplicación'));
  const dir = resolve(opts.dir ?? (await ask('Carpeta de destino', slugify(name))));
  if (existsSync(dir) && readdirSync(dir).length) throw new CliError(`La carpeta ${dir} no está vacía`);
  const owner = (opts.owner ?? (await ask('Correo del propietario (recibirá el primer código de acceso)', ''))).trim().toLowerCase();
  if (owner && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) throw new CliError(`Correo inválido: ${owner}`);
  const modules = new Set(
    (opts.modules ?? (await ask('Módulos (ai, rag, organizations; separados por coma)', 'ai')))
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  );
  for (const m of modules) if (!['ai', 'rag', 'organizations'].includes(m)) throw new CliError(`Módulo desconocido: ${m}`);
  if (modules.has('rag') && !modules.has('ai')) throw new CliError('RAG requiere el módulo de IA (embeddings)');
  const db = (opts.db ?? (await choose('Base de datos', ['docker', 'external'] as const, 'docker'))) as 'docker' | 'external';
  const databaseUrl = db === 'external' ? (opts.databaseUrl ?? (await ask('DATABASE_URL de PostgreSQL 18 con pgvector', ''))) : '';
  if (db === 'external' && !/^postgres(ql)?:\/\//.test(databaseUrl)) throw new CliError('Indica una DATABASE_URL postgres:// válida para la base externa');
  const mail = (opts.mail ?? (await choose('Correo transaccional', ['smtp', 'resend', 'log'] as const, 'smtp'))) as 'smtp' | 'resend' | 'log';
  const from = opts.from ?? defaultTemplate();
  if (!from) throw new CliError('Indica la plantilla con --from <carpeta|repositorio git>');

  if (!opts.yes) {
    console.log(`\n  ${c.dim('Destino')}    ${dir}\n  ${c.dim('Plantilla')}  ${from}${opts.ref ? `#${opts.ref}` : ''}\n  ${c.dim('Módulos')}    ${[...modules].join(', ') || 'ninguno'}\n  ${c.dim('Base')}       ${db}\n  ${c.dim('Correo')}     ${mail}`);
    if (!(await confirm('¿Continuar?', true))) throw new CliError('Cancelado', 0);
  }

  title('Copiando plantilla');
  fetchTemplate(from, dir, opts.ref);
  line('ok', 'Plantilla copiada', dir);

  // Secrets are generated here and written only to .env (never to starter.config.json).
  const pgPassword = secret(18, 'hex');
  const appPassword = secret(18, 'hex');
  const values: Record<string, string> = {
    NODE_ENV: 'development',
    APP_NAME: name,
    BETTER_AUTH_SECRET: secret(32, 'hex'),
    APP_ENCRYPTION_KEY: secret(32, 'base64'),
    OWNER_EMAIL: owner,
    FEATURE_AI: String(modules.has('ai')),
    FEATURE_RAG: String(modules.has('rag')),
    FEATURE_ORGANIZATIONS: String(modules.has('organizations')),
    AI_TEST_PROVIDER_ENABLED: 'false',
    MAIL_TRANSPORT: mail,
    POSTGRES_PASSWORD: pgPassword,
    POSTGRES_APP_PASSWORD: appPassword,
    RAG_POSTGRES_PASSWORD: secret(18, 'hex'),
    DATABASE_URL: db === 'external' ? databaseUrl : `postgres://starter_app:${appPassword}@localhost:5432/starter`,
    DATABASE_MIGRATION_URL: db === 'external' ? '' : `postgres://starter:${pgPassword}@localhost:5432/starter`,
  };
  const example = join(dir, '.env.example');
  if (!existsSync(example)) throw new CliError('La plantilla no tiene .env.example');
  writeFileSync(join(dir, '.env'), renderEnv(readFileSync(example, 'utf8'), values), { mode: 0o600 });
  line('ok', '.env con secretos únicos', 'permisos 600, fuera de git');

  const config = {
    $schema: './docs/schemas/starter.config.schema.json',
    schemaVersion: 1,
    project: { name, slug: slugify(name), locale: 'es-CL', timezone: 'America/Santiago', ...(owner ? { ownerEmail: owner } : {}) },
    features: { organizations: modules.has('organizations'), ai: modules.has('ai'), rag: modules.has('rag') },
    auth: { method: 'email-otp', registration: 'invite-only' },
    database: { mode: db },
    mail: { transport: mail },
  };
  try {
    const { validateStarterConfig } = await import('@starter/config');
    const r = validateStarterConfig(config);
    if (!r.ok) throw new CliError(`starter.config.json inválido: ${JSON.stringify(r.errors)}`);
  } catch (err) {
    if (err instanceof CliError) throw err;
    line('warn', 'No se pudo validar starter.config.json aquí', 'ejecuta "pnpm starter config validate" tras instalar');
  }
  writeFileSync(join(dir, 'starter.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, name: slugify(name), version: '0.1.0' }, null, 2)}\n`);
  line('ok', 'starter.config.json', 'configuración exportable sin secretos');

  if (opts.git !== false && !existsSync(join(dir, '.git'))) {
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['add', '-A'], { cwd: dir });
      line('ok', 'Repositorio git inicializado', 'revisa y haz tu primer commit');
    } catch {
      line('warn', 'git no disponible; omitido');
    }
  }
  if (opts.install !== false) {
    title('Instalando dependencias (pnpm install)');
    const r = spawnSync('pnpm', ['install'], { cwd: dir, stdio: 'inherit' });
    if (r.status !== 0) line('warn', 'pnpm install falló', 'revisa la salida y vuelve a ejecutarlo');
    else line('ok', 'Dependencias instaladas');
  }

  title('Siguientes pasos');
  const rel = relative(process.cwd(), dir);
  const steps = [
    `cd ${!rel ? '.' : rel.startsWith('..') ? dir : rel}`,
    ...(opts.install === false ? ['pnpm install'] : []),
    db === 'docker' ? 'pnpm infra:up             # PostgreSQL 18 + pgvector y Mailpit en Docker' : '# Asegura pgvector en tu PostgreSQL externo (CREATE EXTENSION vector) o deja que la migración lo cree',
    'pnpm build:ts && pnpm db:migrate',
    'pnpm starter doctor',
    'pnpm dev',
  ];
  for (const s of steps) console.log(`  ${c.cyan('$')} ${s}`);
  console.log(`\n  Ingresa en http://localhost:3000 con ${owner || 'el correo de OWNER_EMAIL'}; el código llega a ${mail === 'smtp' ? 'Mailpit (http://localhost:8025)' : mail === 'log' ? 'los logs de la API (solo desarrollo)' : 'tu bandeja (Resend)'}.`);
}
