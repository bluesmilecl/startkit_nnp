import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRoot } from '../lib/project.js';
import { CliError, line, title } from '../lib/ui.js';
import { defaultMailFrom, resolveMail, slugify, writeInstallation, type InstallationChoices } from './create.js';
import { adoptProject } from './project.js';

export interface InitOptions {
  owner?: string;
  name?: string;
  modules?: string;
  db?: string;
  databaseUrl?: string;
  mail?: string;
  mailFrom?: string;
  pgPort?: string;
  mailpitPort?: string;
  mailpitSmtpPort?: string;
  testAi?: boolean;
  /** Name of a new project based on this clone (rename, own Docker project, PROJECT.md). */
  newProject?: string;
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
      writeFileSync(envPath, next);
      chmodSync(envPath, 0o600);
      line('ok', 'OWNER_EMAIL definido', owner);
    } else if (owner && current !== owner) {
      line('warn', `OWNER_EMAIL ya es ${current}`, `no se cambia; para sumar a ${owner} usa "pnpm starter owner assign ${owner} --additional"`);
    } else if (!current) {
      line('warn', 'OWNER_EMAIL vacío', 'repite con --owner <correo> (el primer visitante nunca se vuelve administrador)');
    }
    if (opts.newProject?.trim()) adoptExisting(root, opts.newProject.trim(), readFileSync(envPath, 'utf8'), owner || current);
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
  const mail = resolveMail(opts.mail);
  if (mail !== 'smtp' && mail !== 'log') {
    const { MAIL_TRANSPORT_KEYS } = await import('@starter/config');
    const missing = MAIL_TRANSPORT_KEYS[mail].filter((k) => !process.env[k]);
    if (missing.length) throw new CliError(`Para --mail ${mail} define ${missing.join(' y ')} en la terminal (export ${missing[0]}=…) y repite`);
  }
  const pgPort = opts.pgPort ? Number(opts.pgPort) : undefined;
  if (pgPort !== undefined && !(Number.isInteger(pgPort) && pgPort > 0 && pgPort < 65536)) throw new CliError('--pg-port debe ser un puerto válido');

  const port = (v: string | undefined, flag: string) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!(Number.isInteger(n) && n > 0 && n < 65536)) throw new CliError(`${flag} debe ser un puerto válido`);
    return n;
  };
  // Clones of a project created with --new keep its name and Docker project (starter.config.json is committed).
  const configured = opts.newProject ? null : projectConfig(root);
  const name = opts.newProject?.trim() || opts.name || configured?.name || 'Starter Kit';
  const choices: InstallationChoices = {
    name,
    owner,
    modules,
    db,
    databaseUrl,
    mail,
    mailFrom: opts.mailFrom,
    pgPort,
    testAi: opts.testAi,
    composeProject: opts.newProject ? slugify(name) : configured?.slug,
    mailpitPort: port(opts.mailpitPort, '--mailpit-port'),
    mailpitSmtpPort: port(opts.mailpitSmtpPort, '--mailpit-smtp-port'),
  };
  // A new project writes its own starter.config.json (the starter's one describes the template).
  const hadConfig = existsSync(join(root, 'starter.config.json')) && !opts.newProject;
  await writeInstallation(root, choices, { config: !hadConfig });
  line('ok', '.env con secretos únicos', 'permisos 600, fuera de git');
  line(hadConfig ? 'info' : 'ok', 'starter.config.json', hadConfig ? 'existente, sin cambios' : 'configuración exportable sin secretos');
  line('info', `Propietario: ${owner}`, `módulos: ${[...modules].join(', ') || 'ninguno'} · base: ${db}${pgPort ? ` (puerto ${pgPort})` : ''} · correo: ${mail === 'smtp' && !process.env.SMTP_HOST && !process.env.SMTP_URL ? 'Mailpit local' : mail}`);
  if (mail === 'resend' && !opts.mailFrom) line('warn', 'Remitente de prueba onboarding@resend.dev', 'solo entrega al correo de tu cuenta de Resend; con dominio verificado usa --mail-from "App <no-reply@tudominio>"');
  if (opts.testAi) line('info', 'Proveedor de IA de prueba activo', 'solo desarrollo: permite probar el chat sin claves');
  if (opts.newProject) {
    title(`Proyecto «${name}»`);
    adoptProject(root, { name, owner, modules, mail, mailFrom: opts.mailFrom ?? defaultMailFrom(name, mail), db, pgPort });
  }
  return 0;
}

/** `--new` on an already configured clone: adopts it with the values already in .env (secrets untouched). */
function adoptExisting(root: string, name: string, envText: string, owner: string): void {
  const value = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(envText)?.[1]?.replace(/^"|"$/g, '').trim() ?? '';
  const project = value('COMPOSE_PROJECT_NAME');
  title(`Proyecto «${name}»`);
  if (project !== slugify(name)) line('warn', `Contenedores en el proyecto Docker "${project || 'starter'}"`, 'el .env ya existía: se conserva para no perder la base de datos');
  const modules = new Set((['ai', 'rag', 'organizations'] as const).filter((m) => value(`FEATURE_${m.toUpperCase()}`) === 'true'));
  const pgPort = Number(value('POSTGRES_PORT')) || undefined;
  adoptProject(root, { name, owner, modules, mail: value('MAIL_TRANSPORT') || 'smtp', mailFrom: value('MAIL_FROM'), db: value('DATABASE_MIGRATION_URL') ? 'docker' : 'external', pgPort });
}

function projectConfig(root: string): { name: string; slug: string } | null {
  try {
    const project = (JSON.parse(readFileSync(join(root, 'starter.config.json'), 'utf8')) as { project?: { name?: string; slug?: string } }).project;
    return project?.name && project.slug && project.slug !== 'starter-kit' ? { name: project.name, slug: project.slug } : null;
  } catch {
    return null;
  }
}
