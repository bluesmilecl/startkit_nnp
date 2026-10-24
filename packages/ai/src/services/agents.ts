import { assertCan, recordAudit, type Actor } from '@starter/auth';
import {
  ADMIN_TOOLS,
  AgentConfig,
  AppError,
  type AgentDetail,
  type AgentValidation,
  type AgentVersion,
  type ChatAgentInfo,
} from '@starter/contracts';
import {
  agents,
  agentVersions,
  and,
  desc,
  eq,
  inArray,
  isNull,
  modelCapabilities,
  modelCatalog,
  providerConnections,
  ragCollections,
  sql,
  users,
  type Database,
  type DbOrTx,
} from '@starter/db';
import type { AiDeps } from './connections.js';
import type { PricesService } from './prices.js';

type AgentRow = typeof agents.$inferSelect;
type VersionRow = typeof agentVersions.$inferSelect;
type Issue = AgentValidation['issues'][number];

export interface PublishedAgent {
  agent: AgentRow;
  version: VersionRow;
  config: AgentConfig;
}

const DEFAULT_AGENT = { key: 'asistente', name: 'Asistente' };

/**
 * Configurable agents with immutable published versions: edits happen on a single draft,
 * validated against the real catalog (capabilities, availability, tariffs, collections) before
 * it can be published; rollback republishes an older configuration as a new version so the
 * history stays linear and auditable.
 */
export class AgentsService {
  constructor(
    private readonly deps: AiDeps,
    private readonly prices: PricesService,
  ) {}

  /** Creates the default (unpublished) assistant of an organization when missing. */
  static async ensureDefault(db: Database, organizationId: string): Promise<void> {
    const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.organizationId, organizationId)).limit(1);
    if (existing) return;
    await db.transaction(async (tx) => {
      const [a] = await tx
        .insert(agents)
        .values({ organizationId, key: DEFAULT_AGENT.key, name: DEFAULT_AGENT.name, isDefault: true })
        .onConflictDoNothing()
        .returning();
      if (a) await tx.insert(agentVersions).values({ agentId: a.id, version: 1, status: 'draft', config: AgentConfig.parse({}), notes: 'Versión inicial' });
    });
  }

  static versionDto(v: VersionRow, createdBy: string | null = null): AgentVersion {
    return {
      id: v.id,
      agentId: v.agentId,
      version: v.version,
      status: v.status,
      config: AgentConfig.parse(v.config),
      validation: (v.validation as AgentValidation | null) ?? null,
      notes: v.notes,
      basedOnVersionId: v.basedOnVersionId,
      createdBy,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      publishedAt: v.publishedAt?.toISOString() ?? null,
    };
  }

  private async summaries(organizationId: string, ids?: string[]) {
    const rows = await this.deps.db
      .select()
      .from(agents)
      .where(and(eq(agents.organizationId, organizationId), ids ? inArray(agents.id, ids) : undefined))
      .orderBy(desc(agents.isDefault), agents.name);
    if (!rows.length) return [];
    const versions = await this.deps.db
      .select()
      .from(agentVersions)
      .where(and(inArray(agentVersions.agentId, rows.map((r) => r.id)), inArray(agentVersions.status, ['draft', 'published'])));
    const modelIds = versions.map((v) => AgentConfig.parse(v.config).model.primaryModelId).filter((x): x is string => !!x);
    const models = modelIds.length ? await this.deps.db.select({ id: modelCatalog.id, modelId: modelCatalog.modelId }).from(modelCatalog).where(inArray(modelCatalog.id, modelIds)) : [];
    return rows.map((a) => {
      const pub = versions.find((v) => v.agentId === a.id && v.status === 'published');
      const draft = versions.find((v) => v.agentId === a.id && v.status === 'draft');
      const pubModel = pub ? AgentConfig.parse(pub.config).model.primaryModelId : null;
      return {
        id: a.id,
        key: a.key,
        name: a.name,
        isDefault: a.isDefault,
        archived: !!a.archivedAt,
        published: pub ? { id: pub.id, version: pub.version, publishedAt: pub.publishedAt?.toISOString() ?? null, modelId: models.find((m) => m.id === pubModel)?.modelId ?? null } : null,
        draft: draft ? { id: draft.id, version: draft.version, updatedAt: draft.updatedAt.toISOString(), ok: (draft.validation as AgentValidation | null)?.ok ?? null } : null,
        updatedAt: a.updatedAt.toISOString(),
      };
    });
  }

  async list(actor: Actor) {
    assertCan(actor, 'ai.agents.manage');
    // Organizations created after installation get their (unpublished) assistant on first visit.
    await AgentsService.ensureDefault(this.deps.db, actor.organizationId);
    return this.summaries(actor.organizationId);
  }

  private async findAgent(actor: Actor, id: string, db: DbOrTx = this.deps.db): Promise<AgentRow> {
    const [a] = await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.organizationId, actor.organizationId))).limit(1);
    if (!a) throw AppError.notFound('Agente');
    return a;
  }

  async get(actor: Actor, id: string): Promise<AgentDetail> {
    assertCan(actor, 'ai.agents.manage');
    await this.findAgent(actor, id);
    const [summary] = await this.summaries(actor.organizationId, [id]);
    const versions = await this.deps.db
      .select({ v: agentVersions, email: users.email })
      .from(agentVersions)
      .leftJoin(users, eq(users.id, agentVersions.createdBy))
      .where(eq(agentVersions.agentId, id))
      .orderBy(desc(agentVersions.version));
    return { ...summary!, versions: versions.map((r) => AgentsService.versionDto(r.v, r.email)) };
  }

  async create(actor: Actor, input: { key: string; name: string; basedOnAgentId?: string }) {
    assertCan(actor, 'ai.agents.manage');
    let config = AgentConfig.parse({});
    if (input.basedOnAgentId) {
      await this.findAgent(actor, input.basedOnAgentId);
      const [src] = await this.deps.db
        .select()
        .from(agentVersions)
        .where(and(eq(agentVersions.agentId, input.basedOnAgentId), inArray(agentVersions.status, ['published', 'draft'])))
        .orderBy(sql`case when ${agentVersions.status} = 'draft' then 0 else 1 end`)
        .limit(1);
      if (src) config = AgentConfig.parse(src.config);
    }
    const id = await this.deps.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.organizationId, actor.organizationId), eq(agents.key, input.key)));
      if (dup) throw AppError.conflict('Ya existe un agente con esa clave');
      const [a] = await tx.insert(agents).values({ organizationId: actor.organizationId, key: input.key, name: input.name, createdBy: actor.userId }).returning();
      const validation = await this.validate(actor.organizationId, config, tx);
      await tx.insert(agentVersions).values({ agentId: a!.id, version: 1, status: 'draft', config, validation, createdBy: actor.userId, notes: 'Versión inicial' });
      await recordAudit(tx, actor, { action: 'ai.agents.create', resourceType: 'agent', resourceId: a!.id, outcome: 'success', after: { key: input.key, name: input.name } });
      return a!.id;
    });
    return this.get(actor, id);
  }

  async update(actor: Actor, id: string, input: { name?: string; isDefault?: true; archived?: boolean }) {
    assertCan(actor, 'ai.agents.manage');
    await this.deps.db.transaction(async (tx) => {
      const a = await this.findAgent(actor, id, tx);
      if (input.archived && a.isDefault) throw AppError.conflict('No se puede archivar el agente predeterminado; elige otro primero');
      if (input.isDefault) {
        if (a.archivedAt) throw AppError.conflict('Un agente archivado no puede ser el predeterminado');
        await tx.update(agents).set({ isDefault: false }).where(and(eq(agents.organizationId, actor.organizationId), eq(agents.isDefault, true)));
      }
      await tx
        .update(agents)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.isDefault ? { isDefault: true } : {}),
          ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
        })
        .where(eq(agents.id, id));
      await recordAudit(tx, actor, { action: 'ai.agents.update', resourceType: 'agent', resourceId: id, outcome: 'success', before: { name: a.name, isDefault: a.isDefault, archived: !!a.archivedAt }, after: input });
    });
    return this.get(actor, id);
  }

  /** Saves the single draft (creating it from the published version when needed). */
  async saveDraft(actor: Actor, id: string, input: { config: AgentConfig; notes?: string | null; expectedUpdatedAt?: string }) {
    assertCan(actor, 'ai.agents.manage');
    const config = AgentConfig.parse(input.config);
    await this.deps.db.transaction(async (tx) => {
      await this.findAgent(actor, id, tx);
      await tx.execute(sql`select pg_advisory_xact_lock(727003, hashtext(${id}))`);
      const [draft] = await tx.select().from(agentVersions).where(and(eq(agentVersions.agentId, id), eq(agentVersions.status, 'draft'))).limit(1);
      const validation = await this.validate(actor.organizationId, config, tx);
      if (draft) {
        if (input.expectedUpdatedAt && draft.updatedAt.toISOString() !== input.expectedUpdatedAt) {
          throw AppError.precondition('El borrador fue modificado por otra persona; recarga para ver los cambios');
        }
        await tx.update(agentVersions).set({ config, validation, notes: input.notes ?? draft.notes }).where(eq(agentVersions.id, draft.id));
      } else {
        const [last] = await tx.select().from(agentVersions).where(eq(agentVersions.agentId, id)).orderBy(desc(agentVersions.version)).limit(1);
        const [pub] = await tx.select().from(agentVersions).where(and(eq(agentVersions.agentId, id), eq(agentVersions.status, 'published'))).limit(1);
        await tx.insert(agentVersions).values({ agentId: id, version: (last?.version ?? 0) + 1, status: 'draft', config, validation, notes: input.notes ?? null, basedOnVersionId: pub?.id ?? null, createdBy: actor.userId });
      }
      await tx.update(agents).set({ updatedAt: new Date() }).where(eq(agents.id, id));
      await recordAudit(tx, actor, { action: 'ai.agents.draft.save', resourceType: 'agent', resourceId: id, outcome: 'success', metadata: { ok: validation.ok, issues: validation.issues.length } });
    });
    return this.get(actor, id);
  }

  async discardDraft(actor: Actor, id: string) {
    assertCan(actor, 'ai.agents.manage');
    await this.findAgent(actor, id);
    const [pub] = await this.deps.db.select({ id: agentVersions.id }).from(agentVersions).where(and(eq(agentVersions.agentId, id), eq(agentVersions.status, 'published'))).limit(1);
    if (!pub) throw AppError.conflict('El agente no tiene una versión publicada; el borrador es su única configuración');
    await this.deps.db.delete(agentVersions).where(and(eq(agentVersions.agentId, id), eq(agentVersions.status, 'draft')));
    await recordAudit(this.deps.db, actor, { action: 'ai.agents.draft.discard', resourceType: 'agent', resourceId: id, outcome: 'success' });
    return this.get(actor, id);
  }

  /** Publishes a draft after revalidating it; the previous published version is archived. */
  async publish(actor: Actor, id: string, versionId: string, notes?: string) {
    assertCan(actor, 'ai.agents.manage');
    await this.deps.db.transaction(async (tx) => {
      await this.findAgent(actor, id, tx);
      await tx.execute(sql`select pg_advisory_xact_lock(727003, hashtext(${id}))`);
      const [v] = await tx.select().from(agentVersions).where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, id))).limit(1);
      if (!v) throw AppError.notFound('Versión');
      if (v.status !== 'draft') throw AppError.conflict('Solo se publica un borrador; para volver a una versión anterior usa «restaurar»');
      const config = AgentConfig.parse(v.config);
      const validation = await this.validate(actor.organizationId, config, tx);
      if (!validation.ok) {
        await tx.update(agentVersions).set({ validation }).where(eq(agentVersions.id, v.id));
        throw AppError.validation('La configuración tiene errores; corrígelos antes de publicar', validation.issues.filter((i) => i.severity === 'error'));
      }
      const [prev] = await tx.select().from(agentVersions).where(and(eq(agentVersions.agentId, id), eq(agentVersions.status, 'published'))).limit(1);
      if (prev) await tx.update(agentVersions).set({ status: 'archived' }).where(eq(agentVersions.id, prev.id));
      await tx
        .update(agentVersions)
        .set({ status: 'published', validation, publishedAt: new Date(), publishedBy: actor.userId, notes: notes ?? v.notes })
        .where(eq(agentVersions.id, v.id));
      await tx.update(agents).set({ publishedVersionId: v.id, updatedAt: new Date() }).where(eq(agents.id, id));
      await recordAudit(tx, actor, {
        action: 'ai.agents.publish',
        resourceType: 'agent',
        resourceId: id,
        outcome: 'success',
        before: prev ? { version: prev.version } : null,
        after: { version: v.version, model: config.model.primaryModelId, tools: config.tools.admin, knowledge: config.knowledge.mode },
      });
    });
    return this.get(actor, id);
  }

  /** Republishes an older version's configuration as a new version (history stays linear). */
  async rollback(actor: Actor, id: string, versionId: string) {
    assertCan(actor, 'ai.agents.manage');
    await this.deps.db.transaction(async (tx) => {
      await this.findAgent(actor, id, tx);
      await tx.execute(sql`select pg_advisory_xact_lock(727003, hashtext(${id}))`);
      const [target] = await tx.select().from(agentVersions).where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, id))).limit(1);
      if (!target) throw AppError.notFound('Versión');
      if (target.status !== 'archived') throw AppError.conflict('Solo se restauran versiones archivadas');
      const config = AgentConfig.parse(target.config);
      const validation = await this.validate(actor.organizationId, config, tx);
      if (!validation.ok) throw AppError.validation('La versión ya no es válida con el catálogo actual', validation.issues.filter((i) => i.severity === 'error'));
      const [last] = await tx.select().from(agentVersions).where(eq(agentVersions.agentId, id)).orderBy(desc(agentVersions.version)).limit(1);
      await tx.update(agentVersions).set({ status: 'archived' }).where(and(eq(agentVersions.agentId, id), eq(agentVersions.status, 'published')));
      const [created] = await tx
        .insert(agentVersions)
        .values({
          agentId: id,
          version: last!.version + 1,
          status: 'published',
          config,
          validation,
          notes: `Restauración de la versión ${target.version}`,
          basedOnVersionId: target.id,
          createdBy: actor.userId,
          publishedAt: new Date(),
          publishedBy: actor.userId,
        })
        .returning();
      await tx.update(agents).set({ publishedVersionId: created!.id, updatedAt: new Date() }).where(eq(agents.id, id));
      await recordAudit(tx, actor, { action: 'ai.agents.rollback', resourceType: 'agent', resourceId: id, outcome: 'success', after: { restoredVersion: target.version, newVersion: created!.version } });
    });
    return this.get(actor, id);
  }

  /**
   * Validates a configuration against the catalog of the organization: models must exist, be
   * enabled and support what the agent uses; unknown capabilities and tariffs are warnings.
   */
  async validate(organizationId: string, config: AgentConfig, db: DbOrTx = this.deps.db): Promise<AgentValidation> {
    const issues: Issue[] = [];
    const err = (path: string, message: string) => issues.push({ path, severity: 'error', message });
    const warn = (path: string, message: string) => issues.push({ path, severity: 'warning', message });
    const ids = [config.model.primaryModelId, ...config.model.fallbackModelIds, config.media.transcriptionModelId].filter((x): x is string => !!x);
    const rows = ids.length
      ? await db
          .select({ m: modelCatalog })
          .from(modelCatalog)
          .innerJoin(providerConnections, eq(providerConnections.id, modelCatalog.connectionId))
          .where(and(inArray(modelCatalog.id, ids), eq(providerConnections.organizationId, organizationId)))
      : [];
    const caps = rows.length ? await db.select().from(modelCapabilities).where(inArray(modelCapabilities.modelCatalogId, rows.map((r) => r.m.id))) : [];
    const capOf = (modelId: string, c: string) => caps.find((x) => x.modelCatalogId === modelId && x.capability === c)?.status ?? 'unknown';
    const usesTools = config.tools.admin.length > 0 || config.knowledge.mode === 'tool';

    const checkChat = async (path: string, id: string, label: string) => {
      const m = rows.find((r) => r.m.id === id)?.m;
      if (!m) return err(path, `${label}: el modelo no existe en el catálogo de esta organización`);
      if (!m.enabled) err(path, `${label}: ${m.modelId} está deshabilitado`);
      if (!m.functions.includes('chat')) err(path, `${label}: ${m.modelId} no es un modelo de chat`);
      if (m.availability === 'unavailable') err(path, `${label}: ${m.modelId} no está disponible con la credencial configurada`);
      else if (m.availability !== 'available') warn(path, `${label}: ${m.modelId} no ha sido verificado con la credencial`);
      const need = (cap: string, what: string) => {
        const s = capOf(m.id, cap);
        if (s === 'no') err(path, `${label}: ${m.modelId} no soporta ${what}`);
        else if (s === 'unknown') warn(path, `${label}: soporte de ${what} desconocido en ${m.modelId}`);
      };
      if (usesTools) need('tools', 'herramientas');
      need('streaming', 'streaming');
      if (config.media.attachments && config.media.allowedTypes.includes('image')) need('attachments_image', 'imágenes adjuntas');
      if (config.media.attachments && config.media.allowedTypes.includes('pdf')) need('attachments_pdf', 'PDF adjuntos');
      if (config.model.temperature !== null && capOf(m.id, 'temperature') === 'no') err(path, `${label}: ${m.modelId} no acepta temperatura; déjala vacía`);
      if (m.maxOutputTokens && config.model.maxOutputTokens > m.maxOutputTokens) {
        err('model.maxOutputTokens', `${label}: ${m.modelId} admite como máximo ${m.maxOutputTokens} tokens de salida`);
      }
      const prices = await this.prices.current(m.provider, m.modelId, m.connectionId, new Date(), db);
      if (!prices.some((p) => p.unit === 'input_tokens') || !prices.some((p) => p.unit === 'output_tokens')) {
        warn(path, `${label}: tarifa desconocida para ${m.modelId}; el costo quedará como desconocido y un presupuesto estricto rechazará las solicitudes`);
      }
    };

    if (!config.model.primaryModelId) err('model.primaryModelId', 'Selecciona el modelo principal');
    else await checkChat('model.primaryModelId', config.model.primaryModelId, 'Modelo principal');
    for (const [i, id] of config.model.fallbackModelIds.entries()) {
      if (id === config.model.primaryModelId) err(`model.fallbackModelIds.${i}`, 'El respaldo no puede ser el mismo modelo principal');
      else await checkChat(`model.fallbackModelIds.${i}`, id, `Respaldo ${i + 1}`);
    }

    if (config.media.audioInput) {
      const t = config.media.transcriptionModelId ? rows.find((r) => r.m.id === config.media.transcriptionModelId)?.m : null;
      if (!config.media.transcriptionModelId) err('media.transcriptionModelId', 'La entrada por micrófono requiere un modelo de transcripción');
      else if (!t) err('media.transcriptionModelId', 'El modelo de transcripción no existe en el catálogo');
      else {
        if (!t.functions.includes('transcription')) err('media.transcriptionModelId', `${t.modelId} no es un modelo de transcripción`);
        if (!t.enabled) err('media.transcriptionModelId', `${t.modelId} está deshabilitado`);
        if (t.availability !== 'available') warn('media.transcriptionModelId', `${t.modelId} no ha sido verificado con la credencial`);
      }
    }
    if (config.media.attachments && !config.media.allowedTypes.length) err('media.allowedTypes', 'Elige al menos un tipo de archivo o desactiva los adjuntos');

    if (config.knowledge.mode !== 'off') {
      if (!this.deps.features.rag) err('knowledge.mode', 'El módulo de conocimiento (RAG) está deshabilitado en esta instalación');
      if (!config.knowledge.collectionIds.length) err('knowledge.collectionIds', 'Selecciona al menos una colección');
      else {
        const found = await db
          .select({ id: ragCollections.id, status: ragCollections.status, active: ragCollections.activeIndexVersionId })
          .from(ragCollections)
          .where(and(eq(ragCollections.organizationId, organizationId), inArray(ragCollections.id, config.knowledge.collectionIds)));
        for (const [i, cid] of config.knowledge.collectionIds.entries()) {
          const c = found.find((x) => x.id === cid);
          if (!c) err(`knowledge.collectionIds.${i}`, 'La colección no existe');
          else if (c.status !== 'active') warn(`knowledge.collectionIds.${i}`, 'La colección no está activa');
        }
      }
    }

    for (const key of config.tools.admin) {
      const t = ADMIN_TOOLS[key];
      if (t.proposal) continue;
      if (['users_create', 'users_update', 'users_enable'].includes(key)) {
        warn(`tools.admin`, `«${t.label}» se ejecuta directamente (sin tarjeta de confirmación) con los permisos de quien conversa`);
      }
    }
    return { ok: !issues.some((i) => i.severity === 'error'), checkedAt: new Date().toISOString(), issues };
  }

  /** Published configuration used by the chat; the client can never supply any of it. */
  async resolvePublished(organizationId: string, agentId?: string | null): Promise<PublishedAgent> {
    const [agent] = await this.deps.db
      .select()
      .from(agents)
      .where(and(eq(agents.organizationId, organizationId), isNull(agents.archivedAt), agentId ? eq(agents.id, agentId) : eq(agents.isDefault, true)))
      .limit(1);
    if (!agent) throw agentId ? AppError.notFound('Agente') : new AppError('NOT_CONFIGURED', 'No hay un agente predeterminado configurado');
    if (!agent.publishedVersionId) throw new AppError('NOT_CONFIGURED', `El agente ${agent.name} aún no tiene una versión publicada`);
    const [version] = await this.deps.db.select().from(agentVersions).where(eq(agentVersions.id, agent.publishedVersionId)).limit(1);
    if (!version) throw new AppError('NOT_CONFIGURED', 'La versión publicada no existe');
    return { agent, version, config: AgentConfig.parse(version.config) };
  }

  async loadVersion(actor: Actor, agentId: string, versionId: string): Promise<PublishedAgent> {
    const agent = await this.findAgent(actor, agentId);
    const [version] = await this.deps.db.select().from(agentVersions).where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, agentId))).limit(1);
    if (!version) throw AppError.notFound('Versión');
    return { agent, version, config: AgentConfig.parse(version.config) };
  }

  /** Floating chat descriptor for an actor (published version only). */
  chatInfo(actor: Actor, p: PublishedAgent): ChatAgentInfo {
    const c = p.config;
    return {
      agentId: p.agent.id,
      versionId: p.version.id,
      title: c.ui.title,
      greeting: c.ui.greeting,
      placeholder: c.ui.placeholder,
      suggestions: c.ui.suggestions,
      attachments: { enabled: c.media.attachments, allowedTypes: c.media.allowedTypes, maxFiles: c.media.maxFiles, maxFileBytes: Math.min(c.media.maxFileBytes, this.deps.env.UPLOAD_MAX_BYTES) },
      audioInput: { enabled: c.media.audioInput && !!c.media.transcriptionModelId, maxSeconds: c.media.maxAudioSeconds },
      knowledge: c.knowledge.mode !== 'off',
      showDetails: c.ui.showDetailsToAdmins && actor.permissions.has('ai.usage.read'),
      tools: c.tools.admin.filter((k) => actor.permissions.has(ADMIN_TOOLS[k].permission)).map((k) => ({ key: k, label: ADMIN_TOOLS[k].label, proposal: ADMIN_TOOLS[k].proposal })),
    };
  }
}
