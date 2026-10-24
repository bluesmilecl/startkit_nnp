import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Module generator. New business modules are derived from the live "Proyectos" reference module
 * (contract, table, API module, page and E2E test), so the template can never drift from code
 * that is built, type-checked and tested on every commit.
 */
export interface ModuleSpec {
  /** Plural, kebab-case key used in URLs, file names and permission prefixes, e.g. `purchase-orders`. */
  key: string;
  /** PascalCase singular entity used in identifiers, e.g. `PurchaseOrder`. */
  entity: string;
  /** PascalCase plural (defaults to entity + "s"). */
  entityPlural?: string;
  /** Spanish labels shown in the panel, e.g. "Órdenes de compra" / "Orden de compra". */
  label: string;
  labelSingular: string;
  /** Grammatical gender of the label, used to adjust generated messages. */
  gender?: 'm' | 'f';
  /** Lucide icon for the sidebar entry (defaults to the reference module icon). */
  icon?: string;
}

export interface Names {
  kebab: string;
  snake: string;
  camel: string;
  entity: string;
  entityPlural: string;
  kebabSingular: string;
  snakeSingular: string;
  label: string;
  labelSingular: string;
  prefix: string;
  gender: 'm' | 'f';
  icon: string;
}

export interface FilePlan {
  path: string;
  content: string;
}
export interface PatchPlan {
  path: string;
  description: string;
  apply: (source: string) => string | null;
}
export interface ModulePlan {
  names: Names;
  files: FilePlan[];
  patches: PatchPlan[];
  nextSteps: string[];
}

const RESERVED = new Set(['admin', 'ai', 'api', 'auth', 'rag', 'users', 'roles', 'permissions', 'settings', 'audit', 'projects', 'organizations', 'health', 'jobs', 'system', 'knowledge', 'profile']);
const KEY_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ENTITY_RE = /^[A-Z][A-Za-z0-9]*$/;

const lowerFirst = (s: string) => s.charAt(0).toLocaleLowerCase('es') + s.slice(1);
const pascalToKebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function deriveNames(spec: ModuleSpec): Names {
  if (!KEY_RE.test(spec.key)) throw new Error(`Clave inválida "${spec.key}": usa minúsculas en kebab-case y plural (p. ej. "clientes" o "ordenes-compra")`);
  if (RESERVED.has(spec.key)) throw new Error(`La clave "${spec.key}" está reservada por el starter`);
  if (!ENTITY_RE.test(spec.entity)) throw new Error(`Entidad inválida "${spec.entity}": usa PascalCase singular (p. ej. "Customer")`);
  const entityPlural = spec.entityPlural ?? `${spec.entity}s`;
  if (!ENTITY_RE.test(entityPlural) || entityPlural === spec.entity) throw new Error(`Plural de la entidad inválido "${entityPlural}"`);
  if (!spec.label.trim() || !spec.labelSingular.trim()) throw new Error('Indica las etiquetas en plural y singular');
  const snake = spec.key.replace(/-/g, '_');
  const camel = spec.key.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const kebabSingular = pascalToKebab(spec.entity);
  const parts = spec.key.split('-');
  const prefix = (parts.length > 1 ? parts.map((p) => p[0]).join('') : spec.key.slice(0, 2)).slice(0, 4);
  return {
    kebab: spec.key,
    snake,
    camel,
    entity: spec.entity,
    entityPlural,
    kebabSingular,
    snakeSingular: kebabSingular.replace(/-/g, '_'),
    label: spec.label.trim(),
    labelSingular: spec.labelSingular.trim(),
    prefix,
    gender: spec.gender ?? 'm',
    icon: spec.icon ?? 'FolderKanban',
  };
}

type Replacement = string | ((match: string, ...groups: string[]) => string);

/** Spanish messages of the template are written for a masculine noun ("proyecto"). */
const FEMININE: [RegExp, Replacement][] = [
  [/Nuevo proyecto/g, 'Nueva proyecto'],
  [/Proyecto (creado|actualizado|eliminado)/g, (_m, w) => `Proyecto ${w!.slice(0, -1)}a`],
  [/» (archivado|restaurado)/g, (_m, w) => `» ${w!.slice(0, -1)}a`],
  [/Crea el primero/g, 'Crea la primera'],
  [/Ya existe un proyecto/g, 'Ya existe una proyecto'],
  [/El proyecto fue modificado/g, 'La proyecto fue modificada'],
];

/** Rewrites one reference-module source file for the new module. Order matters. */
export function transform(source: string, n: Names): string {
  let s = source;
  if (n.gender === 'f') for (const [re, rep] of FEMININE) s = s.replace(re, rep as never);
  const rules: [RegExp, Replacement][] = [
    // Spanish labels
    [/Proyectos/g, n.label],
    [/proyectos/g, lowerFirst(n.label)],
    [/Proyecto/g, n.labelSingular],
    [/proyecto/g, lowerFirst(n.labelSingular)],
    // TypeScript identifiers
    [/Projects/g, n.entityPlural],
    [/Project/g, n.entity],
    // Table, index and operation ids (snake_case)
    [/pgTable\('projects'/g, `pgTable('${n.snake}'`],
    [/projects_/g, `${n.snake}_`],
    // Module-relative imports and file names (kebab-case)
    [/\.\/projects\./g, `./${n.kebab}.`],
    // Permission keys, audit actions and permission groups
    [/projects\.(read|manage|create|update|archive|restore|delete)\b/g, (_m, a) => `${n.snake}.${a!}`],
    [/group: 'projects'/g, `group: '${n.snake}'`],
    // Routes, tags and cache keys (kebab-case)
    [/\/projects\b/g, `/${n.kebab}`],
    [/'projects'/g, `'${n.kebab}'`],
    // Generated client functions (projectsList → customersList) and variables
    [/\bprojects(?=[A-Z])/g, n.camel],
    [/\bprojects\b/g, n.camel],
    // Audit resource type and test ids
    [/'project'/g, `'${n.snakeSingular}'`],
    [/\bproject-/g, `${n.kebabSingular}-`],
    [/\bpj-/g, `${n.prefix}-`],
    [/\bFolderKanban\b/g, n.icon],
  ];
  for (const [re, rep] of rules) s = s.replace(re, rep as never);
  return s;
}

const TEMPLATE_FILES = (n: Names): [string, string][] => [
  ['packages/contracts/src/projects.ts', `packages/contracts/src/${n.kebab}.ts`],
  ['packages/db/src/schema/projects.ts', `packages/db/src/schema/${n.kebab}.ts`],
  ['apps/api/src/modules/projects/projects.module.ts', `apps/api/src/modules/${n.kebab}/${n.kebab}.module.ts`],
  ['apps/api/src/modules/projects/projects.controller.ts', `apps/api/src/modules/${n.kebab}/${n.kebab}.controller.ts`],
  ['apps/api/src/modules/projects/projects.service.ts', `apps/api/src/modules/${n.kebab}/${n.kebab}.service.ts`],
  ['apps/web/app/pages/admin/projects/index.vue', `apps/web/app/pages/admin/${n.kebab}/index.vue`],
  ['tests/e2e/projects.spec.ts', `tests/e2e/${n.kebab}.spec.ts`],
];

function insertAfter(anchor: RegExp, text: string) {
  return (source: string) => {
    const m = anchor.exec(source);
    if (!m) return null;
    const at = m.index + m[0].length;
    return source.slice(0, at) + text + source.slice(at);
  };
}

/** Builds the full plan without touching the disk (used by --dry-run and tests). */
export function planModule(root: string, spec: ModuleSpec): ModulePlan {
  const n = deriveNames(spec);
  const files: FilePlan[] = [];
  for (const [from, to] of TEMPLATE_FILES(n)) {
    const src = join(root, from);
    if (!existsSync(src)) throw new Error(`No se encontró el módulo de referencia (${from}); el generador lo usa como plantilla`);
    let content = transform(readFileSync(src, 'utf8'), n);
    if (to.endsWith('.ts') && to.includes('schema')) content = content.replace(/Reference business module \("[^"]*"\) used as the template for `starter generate module`\./, `${n.label}: generated from the reference module.`);
    files.push({ path: to, content });
  }
  const patches: PatchPlan[] = [
    { path: 'packages/contracts/src/index.ts', description: 'exportar el contrato', apply: (s) => (s.includes(`'./${n.kebab}.js'`) ? s : `${s.trimEnd()}\nexport * from './${n.kebab}.js';\n`) },
    { path: 'packages/db/src/schema/index.ts', description: 'exportar la tabla', apply: (s) => (s.includes(`'./${n.kebab}.js'`) ? s : `${s.trimEnd()}\nexport * from './${n.kebab}.js';\n`) },
    {
      path: 'apps/api/src/app.module.ts',
      description: 'registrar el módulo Nest',
      apply: (s) => {
        if (s.includes(`${n.entityPlural}Module`)) return s;
        const withImport = insertAfter(/import \{ ProjectsModule \} from '\.\/modules\/projects\/projects\.module\.js';\n/, `import { ${n.entityPlural}Module } from './modules/${n.kebab}/${n.kebab}.module.js';\n`)(s);
        return withImport ? insertAfter(/ProjectsModule(?=\])/, `, ${n.entityPlural}Module`)(withImport) : null;
      },
    },
    {
      path: 'packages/contracts/src/permissions.ts',
      description: 'agregar permisos y asignarlos a los roles por defecto',
      apply: (s) => {
        if (s.includes(`'${n.snake}.read'`)) return s;
        let out = insertAfter(/ {2}'projects\.manage': \{[^\n]*\},\n/, `  '${n.snake}.read': { group: '${n.snake}', description: 'Ver ${lowerFirst(n.label)}' },\n  '${n.snake}.manage': { group: '${n.snake}', description: 'Crear y editar ${lowerFirst(n.label)}' },\n`)(s);
        out = out && insertAfter(/ {4}'projects\.manage',\n/, `    '${n.snake}.read',\n    '${n.snake}.manage',\n`)(out);
        out = out && insertAfter(/viewer: \[[^\]]*'projects\.read'/, `, '${n.snake}.read'`)(out);
        return out;
      },
    },
    {
      path: 'apps/web/app/utils/navigation.ts',
      description: 'agregar la entrada al menú lateral',
      apply: (s) => {
        if (s.includes(`'/admin/${n.kebab}'`)) return s;
        let out: string | null = s;
        if (!new RegExp(`\\b${n.icon}\\b`).test(s)) {
          out = s.replace(/import \{([^}]*)\} from '@lucide\/vue';/, (_m, names: string) => {
            const list = [...new Set([...names.split(',').map((x) => x.trim()).filter(Boolean), n.icon])].sort();
            return names.includes('\n') ? `import {\n${list.map((x) => `  ${x},`).join('\n')}\n} from '@lucide/vue';` : `import { ${list.join(', ')} } from '@lucide/vue';`;
          });
        }
        return insertAfter(/ {6}\{ title: 'Proyectos', to: '\/admin\/projects'[^\n]*\n/, `      { title: '${n.label}', to: '/admin/${n.kebab}', icon: ${n.icon}, permission: '${n.snake}.read' },\n`)(out);
      },
    },
  ];
  return {
    names: n,
    files,
    patches,
    nextSteps: [
      'pnpm build:ts',
      'pnpm db:generate            # crea la migración de la nueva tabla',
      'pnpm db:migrate',
      'pnpm api:docs:generate && pnpm api:client:generate',
      `Revisa textos, columnas y validaciones en packages/contracts/src/${n.kebab}.ts y la vista /admin/${n.kebab}`,
    ],
  };
}

export interface ApplyResult {
  written: string[];
  patched: string[];
  manual: string[];
}

/** Writes the plan. Existing files are never overwritten unless `force` is set. */
export function applyPlan(root: string, plan: ModulePlan, opts: { force?: boolean } = {}): ApplyResult {
  const conflicts = plan.files.filter((f) => existsSync(join(root, f.path)));
  if (conflicts.length && !opts.force) throw new Error(`Ya existen: ${conflicts.map((c) => c.path).join(', ')} (usa --force para sobrescribir)`);
  const result: ApplyResult = { written: [], patched: [], manual: [] };
  for (const f of plan.files) {
    const p = join(root, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
    result.written.push(f.path);
  }
  for (const patch of plan.patches) {
    const p = join(root, patch.path);
    const before = existsSync(p) ? readFileSync(p, 'utf8') : null;
    const after = before === null ? null : patch.apply(before);
    if (after === null) result.manual.push(`${patch.path}: ${patch.description}`);
    else if (after !== before) {
      writeFileSync(p, after);
      result.patched.push(patch.path);
    }
  }
  return result;
}
