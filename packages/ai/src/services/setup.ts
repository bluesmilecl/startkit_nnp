import type { Actor } from '@starter/auth';
import { AppError, AgentConfig, type CreateConnectionInput } from '@starter/contracts';
import { and, eq, modelCatalog } from '@starter/db';
import type { AiDeps } from './connections.js';
import type { AiServices } from './factory.js';

export interface QuickConnectInput {
  provider: CreateConnectionInput['provider'];
  alias: string;
  apiKey?: string;
  baseUrl?: string | null;
  /** Sync models and tariffs after the credential is accepted (default true). */
  sync?: boolean;
  /** Exact provider model id; verified and published as the default assistant's model. */
  chatModel?: string;
}

export type QuickConnectStep = { step: string; ok: boolean; detail: string };

/**
 * Headless setup used by `starter ai connect` (and by agents installing the starter): creates or
 * rotates the connection, checks the credential, syncs catalog and tariffs and, optionally,
 * verifies one chat model and publishes it on the default assistant. Same services, permission
 * checks and audit trail as the panel; the key is stored encrypted and never echoed.
 */
export async function quickConnect(deps: AiDeps, ai: AiServices, actor: Actor, input: QuickConnectInput, report: (s: QuickConnectStep) => void = () => {}): Promise<{ connectionId: string; agentVersion?: number }> {
  const existing = (await ai.connections.list(actor)).find((c) => c.alias === input.alias);
  const conn = existing
    ? await ai.connections.update(actor, existing.id, { ...(input.apiKey ? { apiKey: input.apiKey } : {}), ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}), disabled: false })
    : await ai.connections.create(actor, { provider: input.provider, alias: input.alias, apiKey: input.apiKey, baseUrl: input.baseUrl ?? null, options: {} });
  report({ step: existing ? 'Conexión actualizada' : 'Conexión creada', ok: true, detail: `${conn.alias} (${conn.provider})${conn.credentialHint ? ` · clave ${conn.credentialHint}` : ''}` });

  const test = await ai.connections.test(actor, conn.id);
  report({ step: 'Credencial', ok: test.ok, detail: test.message });
  if (!test.ok) throw AppError.upstream(test.message, { retryable: test.errorKind === 'network' || test.errorKind === 'timeout' });

  if (input.sync !== false) {
    const models = await ai.models.sync(null, conn.id, actor.organizationId);
    report({ step: 'Modelos', ok: true, detail: `${models.discovered} descubiertos · ${models.enrichedFromCatalog} con datos de catálogo` });
    const prices = await ai.prices.syncFromCatalog(null);
    report({ step: 'Tarifas', ok: true, detail: `${prices.created} nuevas · ${prices.updated} actualizadas` });
  }
  if (!input.chatModel) return { connectionId: conn.id };

  const [model] = await deps.db
    .select({ id: modelCatalog.id })
    .from(modelCatalog)
    .where(and(eq(modelCatalog.connectionId, conn.id), eq(modelCatalog.modelId, input.chatModel)))
    .limit(1);
  if (!model) throw AppError.notFound(`Modelo ${input.chatModel} en ${conn.alias} (revisa el id exacto o sincroniza)`);
  const verified = await ai.models.verify(actor, model.id);
  report({ step: `Modelo ${input.chatModel}`, ok: verified.availability === 'available', detail: verified.message });
  if (verified.availability !== 'available') throw AppError.upstream(`El modelo ${input.chatModel} no respondió: ${verified.message}`, { retryable: false });

  const agent = (await ai.agents.list(actor)).find((a) => a.isDefault);
  if (!agent) throw AppError.notConfigured('No hay un asistente predeterminado; ejecuta las migraciones');
  const detail = await ai.agents.get(actor, agent.id);
  const live = detail.versions.find((v) => v.status === 'published');
  if (live?.config.model.primaryModelId === model.id) {
    // Re-running the setup must not pile up identical versions.
    report({ step: `Asistente «${detail.name}»`, ok: true, detail: `versión ${live.version} ya publicada con ${input.chatModel}` });
    return { connectionId: conn.id, agentVersion: live.version };
  }
  const base = detail.versions.find((v) => v.status === 'draft') ?? live;
  const config = AgentConfig.parse({ ...base?.config, model: { ...base?.config.model, primaryModelId: model.id } });
  const saved = await ai.agents.saveDraft(actor, agent.id, { config, notes: `Modelo ${input.chatModel} configurado desde la CLI` });
  const draft = saved.versions.find((v) => v.status === 'draft');
  if (!draft) throw AppError.conflict('No se encontró el borrador recién guardado');
  const published = await ai.agents.publish(actor, agent.id, draft.id);
  const version = published.versions.find((v) => v.status === 'published')?.version;
  report({ step: `Asistente «${published.name}»`, ok: true, detail: `versión ${version} publicada con ${input.chatModel}` });
  return { connectionId: conn.id, agentVersion: version };
}
