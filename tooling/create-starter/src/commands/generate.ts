import { applyPlan, planModule, type ModuleSpec } from '@starter/generator';
import { findRoot } from '../lib/project.js';
import { ask, c, choose, CliError, line, title } from '../lib/ui.js';

export interface GenerateOptions {
  entity?: string;
  entityPlural?: string;
  label?: string;
  singular?: string;
  gender?: string;
  icon?: string;
  dryRun?: boolean;
  force?: boolean;
}

/** `starter generate module <key>`: scaffolds a module from the Proyectos reference module. */
export async function generateModule(key: string | undefined, opts: GenerateOptions): Promise<number> {
  const root = findRoot();
  const moduleKey = key ?? (await ask('Clave del módulo (plural, kebab-case, p. ej. clientes)'));
  if (!moduleKey) throw new CliError('Indica la clave del módulo: starter generate module <clave>');
  const entity = opts.entity ?? (await ask('Entidad en PascalCase singular (identificadores de código)', 'Customer'));
  const label = opts.label ?? (await ask('Nombre visible en plural', moduleKey.charAt(0).toUpperCase() + moduleKey.slice(1).replace(/-/g, ' ')));
  const singular = opts.singular ?? (await ask('Nombre visible en singular', label.replace(/s$/, '')));
  const gender = (opts.gender ?? (await choose('Género gramatical del nombre', ['m', 'f'] as const, 'm'))) as 'm' | 'f';
  const spec: ModuleSpec = { key: moduleKey, entity, entityPlural: opts.entityPlural, label, labelSingular: singular, gender, icon: opts.icon };

  let plan;
  try {
    plan = planModule(root, spec);
  } catch (err) {
    throw new CliError((err as Error).message);
  }
  title(`Módulo ${plan.names.label} (${plan.names.kebab})`);
  console.log(c.dim(`  permisos ${plan.names.snake}.read / ${plan.names.snake}.manage · tabla ${plan.names.snake} · ruta /admin/${plan.names.kebab} · API /api/${plan.names.kebab}`));
  if (opts.dryRun) {
    for (const f of plan.files) line('info', `crearía ${f.path}`);
    for (const p of plan.patches) line('info', `modificaría ${p.path}`, p.description);
    return 0;
  }
  let result;
  try {
    result = applyPlan(root, plan, { force: opts.force });
  } catch (err) {
    throw new CliError((err as Error).message);
  }
  for (const f of result.written) line('ok', `creado ${f}`);
  for (const f of result.patched) line('ok', `actualizado ${f}`);
  for (const m of result.manual) line('warn', `hazlo a mano: ${m}`, 'no se encontró el punto de inserción');
  title('Siguientes pasos');
  for (const s of plan.nextSteps) console.log(`  ${c.cyan('$')} ${s}`);
  return result.manual.length ? 1 : 0;
}
