#!/usr/bin/env node
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { create } from './commands/create.js';
import { doctor } from './commands/doctor.js';
import { generateModule } from './commands/generate.js';
import { aiSync, configValidate, docsCheck, ownerAssign, ragDoctor, ragReindex } from './commands/ops.js';
import { secretsReencrypt } from './commands/secrets.js';
import { c, CliError } from './lib/ui.js';

const HELP = `${c.bold('create-ecortes-app')} · instalador y CLI del Starter Kit Nuxt + NestJS IA

${c.bold('Uso')}
  pnpm create ecortes-app [carpeta] [opciones]      nueva instalación
  pnpm starter <comando> [opciones]                 operación de un proyecto existente

${c.bold('Comandos')}
  create [carpeta]           Copia la plantilla, genera .env con secretos únicos y starter.config.json
      --from <dir|git>       plantilla (por defecto el repositorio del starter; STARTER_TEMPLATE)
      --ref <rama>           rama o etiqueta al clonar
      --name <nombre> --owner <correo> --modules ai,rag,organizations
      --db docker|external [--database-url <url>] --mail smtp|resend|log
      --yes  --no-install  --no-git
  doctor                     Diagnóstico de entorno, configuración, base, migraciones, propietario, correo, IA y RAG
  config validate [archivo]  Valida starter.config.json (esquema y ausencia de secretos)
  ai sync [--connection a]   Sincroniza catálogos de modelos y tarifas
  rag doctor                 Diagnostica las conexiones de conocimiento
  rag reindex <colección>    Encola una reindexación [--profile clave] [--budget usd] [--wait]
  generate module <clave>    Genera un módulo desde Proyectos
      --entity Customer [--entity-plural Customers] --label "Clientes" --singular "Cliente"
      [--gender m|f] [--icon NombreLucide] [--dry-run] [--force]
  docs check                 Verifica enlaces, comandos, llms.txt y configuración de ejemplo
  owner assign <correo>      Asigna el rol propietario desde el servidor [--additional] [--yes]
  secrets reencrypt          Re-cifra credenciales guardadas con la APP_ENCRYPTION_KEY actual [--dry-run] [--yes]
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      from: { type: 'string' },
      ref: { type: 'string' },
      name: { type: 'string' },
      owner: { type: 'string' },
      modules: { type: 'string' },
      db: { type: 'string' },
      'database-url': { type: 'string' },
      mail: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      'no-install': { type: 'boolean' },
      'no-git': { type: 'boolean' },
      connection: { type: 'string' },
      profile: { type: 'string' },
      budget: { type: 'string' },
      wait: { type: 'boolean' },
      entity: { type: 'string' },
      'entity-plural': { type: 'string' },
      label: { type: 'string' },
      singular: { type: 'string' },
      gender: { type: 'string' },
      icon: { type: 'string' },
      'dry-run': { type: 'boolean' },
      force: { type: 'boolean' },
      additional: { type: 'boolean' },
    },
  });
  if (values.version) {
    const { readFileSync } = await import('node:fs');
    console.log((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version);
    return 0;
  }
  // Invoked as `create-ecortes-app [dir]` (pnpm create): the default command is create.
  const invokedAsCreate = /create-ecortes-app/.test(basename(process.argv[1] ?? ''));
  const known = new Set(['create', 'doctor', 'config', 'ai', 'rag', 'generate', 'docs', 'owner', 'secrets', 'help']);
  const [cmd, sub, arg] = invokedAsCreate && !known.has(positionals[0] ?? '') ? ['create', ...positionals] : positionals;
  if (values.help || !cmd || cmd === 'help') {
    console.log(HELP);
    return values.help || cmd === 'help' ? 0 : 1;
  }
  switch (`${cmd}${['config', 'ai', 'rag', 'generate', 'docs', 'owner', 'secrets'].includes(cmd) ? ` ${sub ?? ''}` : ''}`) {
    case 'create':
      await create({
        dir: sub,
        from: values.from,
        ref: values.ref,
        name: values.name,
        owner: values.owner,
        modules: values.modules,
        db: values.db,
        databaseUrl: values['database-url'],
        mail: values.mail,
        yes: values.yes,
        install: !values['no-install'],
        git: !values['no-git'],
      });
      return 0;
    case 'doctor':
      return doctor();
    case 'config validate':
      return configValidate(arg);
    case 'ai sync':
      return aiSync({ connection: values.connection });
    case 'rag doctor':
      return ragDoctor();
    case 'rag reindex':
      if (!arg) throw new CliError('Uso: starter rag reindex <colección>');
      return ragReindex(arg, { profile: values.profile, budget: values.budget, wait: values.wait });
    case 'generate module':
      return generateModule(arg, {
        entity: values.entity,
        entityPlural: values['entity-plural'],
        label: values.label,
        singular: values.singular,
        gender: values.gender,
        icon: values.icon,
        dryRun: values['dry-run'],
        force: values.force,
      });
    case 'docs check':
      return docsCheck();
    case 'owner assign':
      if (!arg) throw new CliError('Uso: starter owner assign <correo>');
      return ownerAssign(arg, { additional: values.additional, yes: values.yes });
    case 'secrets reencrypt':
      return secretsReencrypt({ yes: values.yes, dryRun: values['dry-run'] });
    default:
      throw new CliError(`Comando desconocido: ${positionals.join(' ')}\n\n${HELP}`);
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof CliError) {
      if (err.message) console.error(err.exitCode ? `${c.red('✖')} ${err.message}` : err.message);
      process.exit(err.exitCode);
    }
    if ((err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`${c.red('✖')} ${(err as Error).message}\n\n${HELP}`);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  });
