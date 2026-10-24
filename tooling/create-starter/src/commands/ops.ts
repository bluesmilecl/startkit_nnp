import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findRoot, projectContext } from '../lib/project.js';
import { c, CliError, confirm, interactive, line, title } from '../lib/ui.js';

/** `starter config validate [file]`: schema + "no secrets" rule of starter.config.json. */
export async function configValidate(file?: string): Promise<number> {
  const path = resolve(file ?? join(findRoot(), 'starter.config.json'));
  if (!existsSync(path)) throw new CliError(`No existe ${path}`);
  const { validateStarterConfig } = await import('@starter/config');
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new CliError(`JSON inválido en ${path}: ${(err as Error).message}`);
  }
  const r = validateStarterConfig(data);
  if (r.ok) {
    line('ok', `${path} es válido`, 'sin secretos ni cadenas de conexión');
    return 0;
  }
  line('fail', `${path} no es válido`);
  for (const e of r.errors) console.log(`    ${c.red('-')} ${e.path || '(raíz)'}: ${e.message}`);
  return 1;
}

/** `starter ai sync [--connection alias]`: refreshes model catalogs and tariffs. */
export async function aiSync(opts: { connection?: string }): Promise<number> {
  const ctx = await projectContext();
  try {
    if (!ctx.env.FEATURE_AI) throw new CliError('El módulo de IA está desactivado (FEATURE_AI=false)');
    const { createAiServices } = await import('@starter/ai');
    const { systemActor } = await import('@starter/auth');
    const ai = createAiServices(ctx.deps);
    const actor = systemActor();
    const conns = (await ai.connections.list(actor)).filter((x) => x.status !== 'disabled' && (!opts.connection || x.alias === opts.connection));
    if (!conns.length) throw new CliError(opts.connection ? `No existe la conexión "${opts.connection}"` : 'No hay conexiones de proveedor; créalas en /admin/ai/connections');
    title('Modelos');
    let failed = 0;
    for (const conn of conns) {
      try {
        const r = await ai.models.sync(null, conn.id, actor.organizationId);
        line('ok', `${conn.alias} (${conn.provider})`, `${r.discovered} descubiertos · ${r.enrichedFromCatalog} con datos de catálogo`);
      } catch (err) {
        failed++;
        line('fail', `${conn.alias} (${conn.provider})`, (err as Error).message);
      }
    }
    title('Tarifas');
    const p = await ai.prices.syncFromCatalog(null);
    line('ok', 'Catálogo de precios', `${p.created} nuevas · ${p.updated} actualizadas · ${p.unchanged} sin cambios · ${p.skipped} omitidas (manuales o sin dato)`);
    console.log(c.dim('\n  Los modelos descubiertos quedan "sin verificar" hasta que pruebes la llamada desde el panel.'));
    return failed ? 1 : 0;
  } finally {
    await ctx.close();
  }
}

/** Environment variable read by default for each provider's key (never a CLI argument). */
const KEY_ENV: Record<string, string> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_GENERATIVE_AI_API_KEY', 'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY', test: '' };

/**
 * `starter ai connect --provider openai [--chat-model gpt-4.1-mini]`: configures AI from the
 * terminal (agents installing the starter have no browser). The key is read from an environment
 * variable (shell or .env), stored encrypted and never printed; with --chat-model the model is
 * verified and published on the default assistant.
 */
export async function aiConnect(opts: { provider?: string; alias?: string; apiKeyEnv?: string; baseUrl?: string; chatModel?: string; sync?: boolean }): Promise<number> {
  const provider = opts.provider ?? '';
  if (!(provider in KEY_ENV)) throw new CliError(`Indica --provider (${Object.keys(KEY_ENV).join(', ')})`);
  const ctx = await projectContext();
  try {
    if (!ctx.env.FEATURE_AI) throw new CliError('El módulo de IA está desactivado (FEATURE_AI=false)');
    if (provider === 'test' && !ctx.env.AI_TEST_PROVIDER_ENABLED) throw new CliError('El proveedor de prueba requiere AI_TEST_PROVIDER_ENABLED=true (solo desarrollo)');
    const envName = opts.apiKeyEnv ?? KEY_ENV[provider]!;
    const apiKey = envName ? process.env[envName]?.trim() || undefined : undefined;
    if (provider !== 'test' && provider !== 'openai-compatible' && !apiKey) {
      throw new CliError(`Define la clave en la variable ${envName} (en la terminal o en .env) y repite; nunca la pases como argumento`);
    }
    const { createAiServices, quickConnect } = await import('@starter/ai');
    const { systemActor } = await import('@starter/auth');
    title('Proveedor de IA');
    const r = await quickConnect(
      ctx.deps,
      createAiServices(ctx.deps),
      systemActor(),
      { provider: provider as 'openai', alias: opts.alias ?? provider, apiKey, baseUrl: opts.baseUrl, chatModel: opts.chatModel, sync: opts.sync },
      (s) => line(s.ok ? 'ok' : 'fail', s.step, s.detail),
    );
    if (!r.agentVersion) console.log(c.dim('\n  Siguiente: repite con --chat-model <id> para publicar el asistente, o elige el modelo en /admin/ai/agents.'));
    return 0;
  } catch (err) {
    // Domain errors (rejected key, unknown model, invalid config) are expected outcomes here.
    if ((err as { name?: string })?.name !== 'AppError') throw err;
    line('fail', (err as Error).message);
    return 1;
  } finally {
    await ctx.close();
  }
}

async function ragServices(ctx: Awaited<ReturnType<typeof projectContext>>, withQueue: boolean) {
  if (!ctx.env.FEATURE_RAG) throw new CliError('El módulo de conocimiento está desactivado (FEATURE_RAG=false)');
  const { createAiServices } = await import('@starter/ai');
  const { createRagServices } = await import('@starter/rag');
  const { JobQueue } = await import('@starter/jobs');
  const jobs = withQueue ? await JobQueue.create({ connectionString: ctx.env.DATABASE_URL, role: 'api' }) : null;
  const ai = createAiServices(ctx.deps);
  return { rag: createRagServices({ ...ctx.deps, jobs, ai }), jobs };
}

/** `starter rag doctor`: diagnoses every knowledge connection (read-only checks). */
export async function ragDoctor(): Promise<number> {
  const ctx = await projectContext();
  try {
    const { rag } = await ragServices(ctx, false);
    const { systemActor } = await import('@starter/auth');
    const actor = systemActor();
    const conns = await rag.connections.list(actor);
    if (!conns.length) {
      line('info', 'Sin conexiones de conocimiento', 'actívalas en /admin/knowledge/connections');
      return 0;
    }
    let bad = 0;
    for (const conn of conns) {
      const r = await rag.connections.diagnose(actor, conn.id);
      title(`${r.name} · ${r.kind} · ${r.status}`);
      for (const ch of r.diagnostic?.checks ?? []) line(ch.status === 'ok' ? 'ok' : ch.status === 'warn' ? 'warn' : 'fail', ch.label, ch.detail ?? undefined);
      const caps = Object.entries(r.capabilities ?? {})
        .filter(([, v]) => v)
        .map(([k]) => k);
      line('info', 'Capacidades', caps.join(', ') || 'ninguna');
      for (const step of r.diagnostic?.manualSteps ?? []) console.log(`    ${c.yellow('→')} ${step}`);
      if (r.status !== 'ready' && r.status !== 'disabled') bad++;
    }
    return bad ? 1 : 0;
  } finally {
    await ctx.close();
  }
}

/** `starter rag reindex <collection> [--profile key] [--budget usd] [--wait]`. */
export async function ragReindex(collection: string, opts: { profile?: string; budget?: string; wait?: boolean }): Promise<number> {
  const ctx = await projectContext();
  const { rag, jobs } = await ragServices(ctx, true);
  try {
    const { systemActor } = await import('@starter/auth');
    const actor = systemActor();
    const all = (await rag.collections.list(actor, { pageSize: 100 })).items;
    const col = all.find((x) => x.id === collection || x.slug === collection);
    if (!col) throw new CliError(`No existe la colección "${collection}" (usa su slug o id). Disponibles: ${all.map((x) => x.slug).join(', ') || 'ninguna'}`);
    let profileId: string | undefined;
    if (opts.profile) {
      const p = (await rag.profiles.list(actor)).find((x) => x.key === opts.profile || x.id === opts.profile);
      if (!p) throw new CliError(`No existe el perfil de embeddings "${opts.profile}"`);
      profileId = p.id;
    }
    const r = await rag.collections.reindex(actor, col.id, { embeddingProfileId: profileId, budgetUsd: opts.budget });
    line('ok', `Reindexación en cola para ${col.name}`, `trabajo ${r.jobId}`);
    if (!opts.wait) {
      console.log(c.dim('  El worker la procesa en segundo plano; sigue el avance en /admin/knowledge/jobs o con --wait.'));
      return 0;
    }
    for (;;) {
      await new Promise((res) => setTimeout(res, 2000));
      const j = await rag.jobs.get(actor, r.jobId);
      process.stdout.write(`\r  ${c.cyan('•')} ${j.status} · ${j.stage ?? ''} ${j.progressTotal ? `${j.progressCurrent}/${j.progressTotal}` : ''}   `);
      if (['succeeded', 'failed', 'cancelled'].includes(j.status)) {
        console.log();
        line(j.status === 'succeeded' ? 'ok' : 'fail', `Reindexación ${j.status}`, j.error ?? `costo ${j.costUsd} USD`);
        return j.status === 'succeeded' ? 0 : 1;
      }
    }
  } finally {
    await jobs?.stop?.().catch(() => {});
    await ctx.close();
  }
}

/**
 * `starter owner assign <email> [--additional] [--yes]`: break-glass owner assignment from the
 * server (requires database access, never exposed over HTTP). Audited as a system action.
 */
export async function ownerAssign(email: string, opts: { additional?: boolean; yes?: boolean }): Promise<number> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CliError(`Correo inválido: ${email}`);
  if (!opts.yes) {
    if (!interactive()) throw new CliError('Confirma con --yes (operación sensible)');
    if (!(await confirm(`¿Asignar el rol propietario a ${email}${opts.additional ? ' (además de los actuales)' : ''}?`))) return 0;
  }
  const ctx = await projectContext();
  try {
    const { InvitationsService } = await import('@starter/auth');
    const r = await InvitationsService.bootstrapOwner(ctx.handle.db, email, { allowAdditional: opts.additional });
    const messages = {
      assigned: ['ok', 'Rol propietario asignado'],
      invited: ['ok', 'Invitación de propietario creada', 'recibirá el rol al ingresar con su código'],
      'already-owner': ['info', 'Ya es propietario'],
      'owner-exists': ['warn', 'Ya existe un propietario activo', 'usa --additional para agregar otro'],
    } as const;
    const [level, label, detail] = messages[r.result] as readonly [('ok' | 'info' | 'warn'), string, string?];
    line(level, label, detail);
    return r.result === 'owner-exists' ? 1 : 0;
  } finally {
    await ctx.close();
  }
}

/** `starter docs check`: links, commands, llms.txt, config example and AI SDK version. */
export function docsCheck(): number {
  const root = findRoot();
  const r = spawnSync(process.execPath, [join(root, 'scripts/docs-check.mjs')], { cwd: root, stdio: 'inherit' });
  return r.status ?? 1;
}
