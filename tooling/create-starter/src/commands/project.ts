import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { line } from '../lib/ui.js';
import { slugify } from './create.js';

export interface ProjectInfo {
  name: string;
  owner: string;
  modules: Set<string>;
  mail: string;
  mailFrom: string;
  db: 'docker' | 'external';
  pgPort?: number;
}

const STARTER_REMOTE = /startkit_nnp(\.git)?\/?$/;

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Short summary of the modules for PROJECT.md. */
function modulesText(modules: Set<string>): string {
  const names = [modules.has('ai') && 'IA (proveedores, costos, agentes y chat)', modules.has('rag') && 'conocimiento (RAG)', modules.has('organizations') && 'organizaciones'].filter(Boolean);
  return names.length ? names.join(', ') : 'solo identidad, permisos y panel';
}

export function projectContext(info: ProjectInfo, base: { version: string; commit: string | null; repository: string; date: string }): string {
  const slug = slugify(info.name);
  const mailText = info.mail === 'smtp' && /no-reply@localhost/.test(info.mailFrom) ? 'Mailpit local (desarrollo); correo real: `pnpm starter mail use resend` ([docs/mail.md](docs/mail.md))' : `${info.mail} · remitente \`${info.mailFrom}\` ([docs/mail.md](docs/mail.md))`;
  return `# ${info.name}

Proyecto creado el ${base.date} a partir del [Starter Kit Nuxt + NestJS IA](${base.repository.replace(/\.git$/, '')}) ${base.version}${base.commit ? ` (commit \`${base.commit}\`)` : ''}.
Este archivo es el **contexto propio del proyecto** para personas y agentes de IA: complétalo a medida
que el proyecto crece. Las reglas técnicas están en [AGENTS.md](AGENTS.md); este archivo manda sobre
ellas solo en lo que es propio del negocio.

## Qué es

_Escribe en dos o tres líneas qué problema resuelve, para quién y qué no hace._

## Configuración

| | |
| --- | --- |
| Propietario | \`${info.owner}\` |
| Módulos | ${modulesText(info.modules)} |
| Correo | ${mailText} |
| Base de datos | ${info.db === 'docker' ? `PostgreSQL 18 + pgvector en Docker (proyecto \`${slug}\`${info.pgPort ? `, puerto ${info.pgPort}` : ''})` : 'PostgreSQL externo (`DATABASE_URL`)'} |
| Contenedores | proyecto Docker \`${slug}\`: no se mezclan con otras instalaciones del starter |

## Comandos

\`\`\`bash
node scripts/quickstart.mjs            # repetible: instala lo que falte y diagnostica
pnpm dev                               # web :3000 · API :3001 · worker
pnpm starter doctor                    # estado de la instalación
pnpm starter generate module clientes --entity Customer --label "Clientes" --singular "Cliente"
pnpm verify                            # antes de entregar
\`\`\`

## Construir encima

1. Cada entidad del negocio es un módulo generado desde Proyectos (contrato, tabla, API, vista,
   permisos, menú y prueba E2E). Luego \`pnpm build:ts && pnpm db:generate && pnpm db:migrate\` y
   \`pnpm api:docs:generate && pnpm api:client:generate\`.
2. Pantallas con el kit: guía en [docs/frontend-components.md](docs/frontend-components.md) y
   ejemplos vivos en \`/admin/components\`.
3. Errores, correo y permisos siguen [docs/errors.md](docs/errors.md), [docs/mail.md](docs/mail.md)
   y [docs/permissions.md](docs/permissions.md).
4. «Terminado» es la lista de [AGENTS.md](AGENTS.md#definición-de-terminado).

## Módulos propios

| Módulo | Rutas | Permisos | Notas |
| --- | --- | --- | --- |
<!-- modules: el generador agrega una fila por módulo -->

## Decisiones

_Anota aquí decisiones de negocio y sus razones (fecha · decisión · por qué)._

## Actualizar desde el starter

El repositorio original quedó como el remoto \`starter\`: \`git fetch starter\` y fusiona la
etiqueta o rama que quieras (detalle en [docs/upgrades.md](docs/upgrades.md)).
`;
}

/** Keeps the starter as the `starter` remote so `origin` is free for the project's own repository. */
function adoptRepository(root: string): void {
  const origin = git(root, ['remote', 'get-url', 'origin']);
  if (origin && STARTER_REMOTE.test(origin) && git(root, ['remote', 'get-url', 'starter']) === null) {
    git(root, ['remote', 'rename', 'origin', 'starter']);
    line('ok', 'Remoto origin → starter', 'para traer mejoras del starter; agrega tu repositorio con "git remote add origin <url>"');
  } else if (origin && !STARTER_REMOTE.test(origin)) {
    line('info', `Remoto origin sin cambios (${origin})`);
  } else if (!existsSync(join(root, '.git'))) {
    git(root, ['init', '-q', '-b', 'main']);
    line('ok', 'Repositorio git inicializado');
  }
}

/**
 * Turns a fresh clone of the starter into the user's own project: package name, Docker project
 * name (set in .env by the caller), the starter kept as the `starter` remote for updates, and
 * PROJECT.md imported by the agents' entry files. Never deletes history or overwrites PROJECT.md.
 */
export function adoptProject(root: string, info: ProjectInfo, opts: { git?: boolean } = {}): void {
  const slug = slugify(info.name);
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
  if (pkg.name !== slug) {
    writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, name: slug, version: '0.1.0' }, null, 2)}\n`);
    line('ok', `package.json → ${slug}`);
  }

  if (opts.git !== false) adoptRepository(root);

  const projectPath = join(root, 'PROJECT.md');
  if (!existsSync(projectPath)) {
    const manifest = JSON.parse(readFileSync(join(root, 'starter.manifest.json'), 'utf8')) as { version?: string };
    let repository = 'https://github.com/bluesmilecl/startkit_nnp';
    try {
      const cli = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { starter?: { templateRepository?: string } };
      repository = cli.starter?.templateRepository ?? repository;
    } catch {
      // keep the default repository
    }
    writeFileSync(projectPath, projectContext(info, { version: `v${manifest.version ?? '0.0.0'}`, commit: git(root, ['rev-parse', '--short', 'HEAD']), repository, date: new Date().toISOString().slice(0, 10) }));
    line('ok', 'PROJECT.md', 'contexto propio del proyecto para personas y agentes de IA');
  }
  for (const file of ['CLAUDE.md', 'GEMINI.md']) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    const s = readFileSync(p, 'utf8');
    if (s.includes('@PROJECT.md')) continue;
    writeFileSync(p, s.replace('@AGENTS.md', '@PROJECT.md\n@AGENTS.md'));
    line('ok', `${file} importa PROJECT.md`);
  }
}
