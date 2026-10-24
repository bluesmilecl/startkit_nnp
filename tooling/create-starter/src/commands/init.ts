import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRoot } from '../lib/project.js';
import { CliError, line, title } from '../lib/ui.js';
import { writeInstallation, type InstallationChoices } from './create.js';

export interface InitOptions {
  owner?: string;
  name?: string;
  modules?: string;
  db?: string;
  databaseUrl?: string;
  mail?: string;
  pgPort?: string;
  testAi?: boolean;
  /** Directory inside the project (defaults to the current one). */
  cwd?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `starter init`: prepares the current clone (no copy, no prompts) for agents and scripts.
 * Creates .env with unique secrets and starter.config.json when missing; an existing .env is
 * never overwritten (only an empty OWNER_EMAIL is filled), so the command is safe to re-run.
 */
export async function init(opts: InitOptions): Promise<number> {
  const root = findRoot(opts.cwd);
  const owner = (opts.owner ?? '').trim().toLowerCase();
  if (owner && !EMAIL.test(owner)) throw new CliError(`Correo inválido: ${owner}`);
  const envPath = join(root, '.env');
  title('Configuración local');

  if (existsSync(envPath)) {
    const text = readFileSync(envPath, 'utf8');
    const current = /^OWNER_EMAIL=(.*)$/m.exec(text)?.[1]?.replace(/^"|"$/g, '').trim() ?? '';
    line('ok', '.env existente', 'no se modifican sus secretos');
    if (owner && !current) {
      const next = /^OWNER_EMAIL=.*$/m.test(text) ? text.replace(/^OWNER_EMAIL=.*$/m, `OWNER_EMAIL=${owner}`) : `${text.trimEnd()}\nOWNER_EMAIL=${owner}\n`;
      writeFileSync(envPath, next, { mode: 0o600 });
      line('ok', 'OWNER_EMAIL definido', owner);
    } else if (owner && current !== owner) {
      line('warn', `OWNER_EMAIL ya es ${current}`, `no se cambia; para sumar a ${owner} usa "pnpm starter owner assign ${owner} --additional"`);
    } else if (!current) {
      line('warn', 'OWNER_EMAIL vacío', 'repite con --owner <correo> (el primer visitante nunca se vuelve administrador)');
    }
    return 0;
  }

  if (!owner) throw new CliError('Indica --owner <correo>: esa persona recibirá el primer código de acceso y será la propietaria');
  const modules = new Set((opts.modules ?? 'ai,rag').split(',').map((m) => m.trim()).filter(Boolean));
  for (const m of modules) if (!['ai', 'rag', 'organizations'].includes(m)) throw new CliError(`Módulo desconocido: ${m}`);
  if (modules.has('rag') && !modules.has('ai')) throw new CliError('RAG requiere el módulo de IA (embeddings)');
  const db = (opts.db ?? 'docker') as InstallationChoices['db'];
  if (!['docker', 'external'].includes(db)) throw new CliError('--db debe ser docker o external');
  const databaseUrl = opts.databaseUrl ?? '';
  if (db === 'external' && !/^postgres(ql)?:\/\//.test(databaseUrl)) throw new CliError('Con --db external indica --database-url postgres://…');
  const mail = (opts.mail ?? 'smtp') as InstallationChoices['mail'];
  if (!['smtp', 'resend', 'log'].includes(mail)) throw new CliError('--mail debe ser smtp, resend o log');
  const pgPort = opts.pgPort ? Number(opts.pgPort) : undefined;
  if (pgPort !== undefined && !(Number.isInteger(pgPort) && pgPort > 0 && pgPort < 65536)) throw new CliError('--pg-port debe ser un puerto válido');

  const hadConfig = existsSync(join(root, 'starter.config.json'));
  await writeInstallation(root, { name: opts.name ?? 'Starter Kit', owner, modules, db, databaseUrl, mail, pgPort, testAi: opts.testAi }, { config: !hadConfig });
  line('ok', '.env con secretos únicos', 'permisos 600, fuera de git');
  line(hadConfig ? 'info' : 'ok', 'starter.config.json', hadConfig ? 'existente, sin cambios' : 'configuración exportable sin secretos');
  line('info', `Propietario: ${owner}`, `módulos: ${[...modules].join(', ') || 'ninguno'} · base: ${db}${pgPort ? ` (puerto ${pgPort})` : ''} · correo: ${mail}`);
  if (opts.testAi) line('info', 'Proveedor de IA de prueba activo', 'solo desarrollo: permite probar el chat sin claves');
  return 0;
}
