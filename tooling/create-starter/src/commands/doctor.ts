import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRoot, loadEnv, readJson } from '../lib/project.js';
import { c, line, title, type Level } from '../lib/ui.js';

interface Check {
  level: Level;
  label: string;
  detail?: string;
}

const version = (v: string) => v.replace(/^v/, '').split('.').map(Number) as [number, number, number];
const gte = (a: number[], b: number[]) => a[0]! > b[0]! || (a[0] === b[0] && (a[1]! > b[1]! || (a[1] === b[1] && a[2]! >= b[2]!)));
const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/**
 * Read-only installation check: runtime, configuration, database, migrations, owner, mail, AI
 * and knowledge. It never prints secrets and never changes data.
 */
export async function doctor(): Promise<number> {
  const root = findRoot();
  const checks: Check[] = [];
  let failures = 0;
  const add = (level: Level, label: string, detail?: string) => {
    if (level === 'fail') failures++;
    checks.push({ level, label, detail });
  };

  title('Entorno');
  const pkg = readJson<{ engines?: { node?: string }; packageManager?: string }>(join(root, 'package.json'));
  const minNode = version((pkg.engines?.node ?? '>=24.11.0').replace(/[^0-9.]/g, ''));
  add(gte(version(process.version), minNode) ? 'ok' : 'fail', `Node ${process.version}`, `requiere ${pkg.engines?.node}`);
  const pnpm = run('pnpm', ['--version']);
  const wantedPnpm = pkg.packageManager?.split('@')[1];
  add(pnpm ? (pnpm === wantedPnpm ? 'ok' : 'warn') : 'fail', `pnpm ${pnpm ?? 'no encontrado'}`, wantedPnpm ? `el proyecto fija ${wantedPnpm} (corepack enable)` : undefined);
  const docker = run('docker', ['compose', 'version', '--short']);
  add(docker ? 'ok' : 'warn', docker ? `Docker Compose ${docker}` : 'Docker Compose no disponible', docker ? undefined : 'necesario solo para los perfiles locales');
  const built = ['packages/db/dist/index.js', 'apps/api/dist/main.js', 'apps/worker/dist/main.js'].every((f) => existsSync(join(root, f)));
  add(built ? 'ok' : 'warn', built ? 'Compilación TypeScript presente' : 'Falta compilar', built ? undefined : 'pnpm build:ts');
  for (const ch of checks.splice(0)) line(ch.level, ch.label, ch.detail);

  title('Configuración');
  if (!loadEnv(root)) add('fail', 'No existe .env', 'copia .env.example o usa create-ecortes-app');
  const config = await import('@starter/config');
  let env: import('@starter/config').Env | null = null;
  try {
    env = config.parseEnv(process.env);
    add('ok', `Variables válidas (NODE_ENV=${env.NODE_ENV})`);
  } catch (err) {
    const issues = (err as { issues?: { path: string; message: string }[] }).issues;
    add('fail', 'Variables de entorno inválidas', issues?.map((i) => `${i.path}: ${i.message}`).join('; ') ?? (err as Error).message);
  }
  if (env) {
    if (/change-me/.test(env.BETTER_AUTH_SECRET)) add('fail', 'BETTER_AUTH_SECRET es el valor de ejemplo', 'genera uno aleatorio');
    if (env.NODE_ENV === 'production') {
      if (!env.APP_URL.startsWith('https://')) add('warn', 'APP_URL no usa HTTPS en producción');
      if (env.OPENAPI_DOCS === 'public') add('warn', 'OPENAPI_DOCS=public expone la referencia de la API sin sesión');
      if (env.RAG_FETCH_ALLOW_PRIVATE) add('warn', 'RAG_FETCH_ALLOW_PRIVATE=true permite descargar URLs de redes privadas');
    }
    add(env.OWNER_EMAIL ? 'ok' : 'warn', env.OWNER_EMAIL ? 'OWNER_EMAIL definido' : 'OWNER_EMAIL vacío', env.OWNER_EMAIL ? undefined : 'el primer visitante nunca se vuelve administrador; usa "starter owner assign"');
    add('info', `Módulos: IA ${env.FEATURE_AI ? 'activa' : 'desactivada'} · conocimiento ${env.FEATURE_RAG ? 'activo' : 'desactivado'} · organizaciones ${env.FEATURE_ORGANIZATIONS ? 'activas' : 'desactivadas'}`);
  }
  const cfgPath = join(root, 'starter.config.json');
  if (existsSync(cfgPath)) {
    const r = config.validateStarterConfig(JSON.parse(readFileSync(cfgPath, 'utf8')));
    add(r.ok ? 'ok' : 'fail', 'starter.config.json', r.ok ? 'válido y sin secretos' : JSON.stringify(r.errors));
  } else add('info', 'Sin starter.config.json', 'opcional');
  for (const ch of checks.splice(0)) line(ch.level, ch.label, ch.detail);

  if (env) {
    title('Servicios');
    const { createDb, sql } = await import('@starter/db');
    const handle = createDb(env.DATABASE_URL, { max: 1, ssl: env.DATABASE_SSL, applicationName: 'starter-doctor' });
    try {
      const v = await handle.db.execute<{ v: string }>(sql`select current_setting('server_version') as v`);
      add('ok', `PostgreSQL ${v.rows[0]?.v}`, new URL(env.DATABASE_URL).host);
      const ext = await handle.db.execute<{ installed: string | null; available: string | null }>(sql`select installed_version as installed, default_version as available from pg_available_extensions where name = 'vector'`);
      const e = ext.rows[0];
      add(e?.installed ? 'ok' : e?.available ? 'warn' : env.FEATURE_RAG ? 'fail' : 'info', e?.installed ? `pgvector ${e.installed}` : e?.available ? `pgvector ${e.available} disponible, no instalado` : 'pgvector no disponible', e?.installed ? undefined : 'se instala al migrar o activar el conocimiento interno');
      const journal = readJson<{ entries: unknown[] }>(join(root, 'packages/db/migrations/meta/_journal.json')).entries.length;
      const applied = await handle.db.execute<{ n: number }>(sql`select count(*)::int as n from public.__migrations`).catch(() => null);
      const n = applied?.rows[0]?.n ?? 0;
      add(n >= journal ? 'ok' : 'fail', `Migraciones ${n}/${journal}`, n >= journal ? undefined : 'pnpm db:migrate');
      if (applied) {
        const owners = await handle.db.execute<{ n: number }>(sql`select count(*)::int as n from user_roles ur join roles r on r.id = ur.role_id join users u on u.id = ur.user_id where r.key = 'owner' and u.disabled_at is null`);
        const pending = await handle.db.execute<{ n: number }>(sql`select count(*)::int as n from invitations where kind = 'bootstrap' and status = 'pending'`);
        const o = owners.rows[0]?.n ?? 0;
        add(o ? 'ok' : pending.rows[0]?.n ? 'warn' : 'fail', o ? `${o} propietario(s) activo(s)` : pending.rows[0]?.n ? 'Propietario invitado, aún no ingresa' : 'Sin propietario', o ? undefined : 'ingresa con OWNER_EMAIL o usa "starter owner assign"');
        if (env.FEATURE_AI) {
          const ai = await handle.db.execute<{ conns: number; verified: number; prices: number }>(
            sql`select (select count(*)::int from provider_connections where status <> 'disabled') as conns, (select count(*)::int from model_catalog where availability = 'available') as verified, (select count(*)::int from model_prices where effective_to is null) as prices`,
          );
          const a = ai.rows[0]!;
          add(a.conns ? 'ok' : 'warn', `IA: ${a.conns} conexión(es), ${a.verified} modelo(s) verificados, ${a.prices} tarifa(s) vigentes`, a.conns ? undefined : 'configura un proveedor en /admin/ai/connections');
        }
        if (env.FEATURE_RAG) {
          const rag = await handle.db.execute<{ name: string; kind: string; status: string }>(sql`select name, kind, status from rag_connections order by name`);
          if (!rag.rows.length) add('info', 'Conocimiento: sin conexiones', 'activa una en /admin/knowledge/connections');
          for (const r of rag.rows) add(r.status === 'ready' ? 'ok' : r.status === 'disabled' ? 'info' : 'warn', `Conocimiento: ${r.name} (${r.kind})`, r.status);
        }
      }
    } catch (err) {
      add('fail', 'No se pudo conectar a PostgreSQL', (err as Error).message.replace(/postgres(ql)?:\/\/[^@\s]*@/g, 'postgres://***@'));
    } finally {
      await handle.close();
    }
    if (env.MAIL_TRANSPORT === 'log') add(env.NODE_ENV === 'production' ? 'fail' : 'info', 'Correo: log', 'solo desarrollo: los mensajes quedan en el log');
    else {
      const { createMailer } = await import('@starter/mail');
      const check = await createMailer(env).verify();
      add(check.ok ? 'ok' : 'warn', `Correo: ${env.MAIL_TRANSPORT}`, `${check.detail ?? ''}${check.ok ? '' : ' (los códigos de acceso no llegarán)'}`);
      if (env.NODE_ENV === 'production' && /@localhost>?$/.test(env.MAIL_FROM)) add('warn', `MAIL_FROM=${env.MAIL_FROM}`, 'usa un remitente de tu dominio verificado');
    }
    for (const ch of checks.splice(0)) line(ch.level, ch.label, ch.detail);
  }

  for (const ch of checks.splice(0)) line(ch.level, ch.label, ch.detail);
  const failed = failures > 0;
  console.log(`\n${failed ? c.red('Hay problemas que resolver.') : c.green('Instalación en buen estado.')}`);
  return failed ? 1 : 0;
}
