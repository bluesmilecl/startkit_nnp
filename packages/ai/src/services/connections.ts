import { assertCan, recordAudit, type AccessDeps, type Actor } from '@starter/auth';
import { maskSecret, resolveSecretRef, type SecretBox } from '@starter/config';
import { AppError, type Connection, type CreateConnectionInput, type UpdateConnectionInput } from '@starter/contracts';
import { and, asc, count, eq, modelCatalog, providerConnections, sql, type DbOrTx } from '@starter/db';
import { assertAllowedEndpoint } from '../endpoint-policy.js';
import { classifyAiError } from '../errors.js';
import { createProviderClient, PROVIDERS, type ProviderClient, type ProviderKey, type ResolvedConnection } from '../providers/registry.js';

export interface AiDeps extends AccessDeps {
  secrets: SecretBox;
}

type Row = typeof providerConnections.$inferSelect;

const READ_PERMS = ['ai.providers.manage', 'ai.models.manage', 'ai.agents.manage', 'ai.lab.use', 'rag.collections.manage'] as const;

export class ConnectionsService {
  constructor(private readonly deps: AiDeps) {}

  providerAvailable(key: ProviderKey): boolean {
    return key !== 'test' || this.deps.env.AI_TEST_PROVIDER_ENABLED;
  }

  providers() {
    return Object.values(PROVIDERS).map((p) => ({ ...p, available: this.providerAvailable(p.key) }));
  }

  private assertRead(actor: Actor): void {
    if (!READ_PERMS.some((p) => actor.permissions.has(p))) throw AppError.forbidden('Permiso requerido: ai.providers.manage');
  }

  private toDto(row: Row, modelCount: number): Connection {
    return {
      id: row.id,
      provider: row.provider as ProviderKey,
      alias: row.alias,
      baseUrl: row.baseUrl,
      credentialSource: row.credentialCiphertext ? 'stored' : row.credentialRef ? 'reference' : 'none',
      credentialHint: row.credentialHint,
      status: row.status,
      lastErrorKind: (row.lastErrorKind as Connection['lastErrorKind']) ?? null,
      lastError: row.lastError,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      options: row.options,
      modelCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(actor: Actor): Promise<Connection[]> {
    this.assertRead(actor);
    const rows = await this.deps.db
      .select({ c: providerConnections, n: sql<number>`(select count(*)::int from ${modelCatalog} m where m.connection_id = ${providerConnections.id})` })
      .from(providerConnections)
      .where(eq(providerConnections.organizationId, actor.organizationId))
      .orderBy(asc(providerConnections.alias));
    return rows.map((r) => this.toDto(r.c, r.n));
  }

  async findRow(actor: Actor, id: string, db: DbOrTx = this.deps.db): Promise<Row> {
    const [row] = await db
      .select()
      .from(providerConnections)
      .where(and(eq(providerConnections.id, id), eq(providerConnections.organizationId, actor.organizationId)))
      .limit(1);
    if (!row) throw AppError.notFound('Conexión');
    return row;
  }

  async get(actor: Actor, id: string): Promise<Connection> {
    this.assertRead(actor);
    const row = await this.findRow(actor, id);
    const [n] = await this.deps.db.select({ n: count() }).from(modelCatalog).where(eq(modelCatalog.connectionId, id));
    return this.toDto(row, n?.n ?? 0);
  }

  private async validateEndpoint(provider: ProviderKey, baseUrl: string | null | undefined): Promise<void> {
    const info = PROVIDERS[provider];
    if (info.requiresBaseUrl && !baseUrl) throw AppError.validation('Este proveedor requiere la URL base (endpoint) de la API');
    if (baseUrl) await assertAllowedEndpoint(baseUrl, { allowPrivate: this.deps.env.AI_ALLOW_PRIVATE_ENDPOINTS });
  }

  private credentialFields(input: { apiKey?: string; credentialRef?: string | null }) {
    if (input.apiKey && input.credentialRef) throw AppError.validation('Usa una clave o una referencia de secreto, no ambas');
    if (input.apiKey) return { credentialCiphertext: this.deps.secrets.encrypt(input.apiKey), credentialRef: null, credentialHint: maskSecret(input.apiKey) };
    if (input.credentialRef) return { credentialCiphertext: null, credentialRef: input.credentialRef, credentialHint: input.credentialRef };
    return null;
  }

  async create(actor: Actor, input: CreateConnectionInput): Promise<Connection> {
    assertCan(actor, 'ai.providers.manage');
    if (!this.providerAvailable(input.provider)) throw new AppError('FEATURE_DISABLED', 'El proveedor de prueba está deshabilitado en esta instalación');
    await this.validateEndpoint(input.provider, input.baseUrl);
    if (PROVIDERS[input.provider].requiresApiKey && !input.apiKey && !input.credentialRef) {
      throw AppError.validation('Este proveedor requiere una clave de API o una referencia de secreto');
    }
    const cred = this.credentialFields(input) ?? { credentialCiphertext: null, credentialRef: null, credentialHint: null };
    const id = await this.deps.db.transaction(async (tx) => {
      const [dup] = await tx
        .select({ id: providerConnections.id })
        .from(providerConnections)
        .where(and(eq(providerConnections.organizationId, actor.organizationId), eq(providerConnections.alias, input.alias)));
      if (dup) throw AppError.conflict('Ya existe una conexión con ese alias');
      const [row] = await tx
        .insert(providerConnections)
        .values({
          organizationId: actor.organizationId,
          provider: input.provider,
          alias: input.alias,
          baseUrl: input.baseUrl ?? null,
          options: input.options ?? {},
          createdBy: actor.userId,
          ...cred,
        })
        .returning();
      await recordAudit(tx, actor, {
        action: 'ai.connections.create',
        resourceType: 'provider_connection',
        resourceId: row!.id,
        outcome: 'success',
        after: { provider: row!.provider, alias: row!.alias, baseUrl: row!.baseUrl, credential: cred.credentialHint },
      });
      return row!.id;
    });
    return this.get(actor, id);
  }

  async update(actor: Actor, id: string, input: UpdateConnectionInput): Promise<Connection> {
    assertCan(actor, 'ai.providers.manage');
    const row = await this.findRow(actor, id);
    if (input.baseUrl !== undefined) await this.validateEndpoint(row.provider as ProviderKey, input.baseUrl);
    const cred = this.credentialFields({ apiKey: input.apiKey, credentialRef: input.credentialRef ?? undefined });
    const patch: Partial<Row> = {};
    if (input.alias) patch.alias = input.alias;
    if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
    if (input.options) patch.options = input.options;
    if (input.disabled !== undefined) patch.status = input.disabled ? 'disabled' : 'unverified';
    if (cred) Object.assign(patch, cred, { status: 'unverified', lastError: null, lastErrorKind: null });
    await this.deps.db.transaction(async (tx) => {
      await tx.update(providerConnections).set(patch).where(eq(providerConnections.id, id));
      await recordAudit(tx, actor, {
        action: cred ? 'ai.connections.rotateCredential' : 'ai.connections.update',
        resourceType: 'provider_connection',
        resourceId: id,
        outcome: 'success',
        before: { alias: row.alias, baseUrl: row.baseUrl, status: row.status, credential: row.credentialHint },
        after: { alias: patch.alias ?? row.alias, baseUrl: patch.baseUrl ?? row.baseUrl, status: patch.status ?? row.status, credential: cred?.credentialHint ?? row.credentialHint },
      });
    });
    return this.get(actor, id);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    assertCan(actor, 'ai.providers.manage');
    const row = await this.findRow(actor, id);
    try {
      await this.deps.db.transaction(async (tx) => {
        await tx.delete(providerConnections).where(eq(providerConnections.id, id));
        await recordAudit(tx, actor, {
          action: 'ai.connections.delete',
          resourceType: 'provider_connection',
          resourceId: id,
          outcome: 'success',
          before: { provider: row.provider, alias: row.alias },
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23503' || /foreign key/i.test((err as Error).message)) {
        throw AppError.conflict('La conexión está en uso por perfiles de embeddings u otros recursos; reemplázala antes de eliminarla');
      }
      throw err;
    }
  }

  /** Decrypts/resolves the credential. Internal use only — never returned by the API. */
  resolve(row: Row): ResolvedConnection {
    let apiKey: string | null = null;
    if (row.credentialCiphertext) apiKey = this.deps.secrets.decrypt(row.credentialCiphertext);
    else if (row.credentialRef) apiKey = resolveSecretRef(row.credentialRef);
    return { id: row.id, provider: row.provider as ProviderKey, alias: row.alias, baseUrl: row.baseUrl, apiKey, options: row.options };
  }

  async client(organizationId: string, connectionId: string): Promise<{ row: Row; client: ProviderClient }> {
    const [row] = await this.deps.db
      .select()
      .from(providerConnections)
      .where(and(eq(providerConnections.id, connectionId), eq(providerConnections.organizationId, organizationId)))
      .limit(1);
    if (!row) throw AppError.notFound('Conexión');
    if (row.status === 'disabled') throw new AppError('NOT_CONFIGURED', `La conexión ${row.alias} está deshabilitada`);
    if (!this.providerAvailable(row.provider as ProviderKey)) throw new AppError('FEATURE_DISABLED', 'Proveedor deshabilitado en esta instalación');
    return { row, client: createProviderClient(this.resolve(row)) };
  }

  /** Probes the credential by listing models (free); records a classified status. */
  async test(actor: Actor, id: string) {
    assertCan(actor, 'ai.providers.manage');
    const t0 = Date.now();
    const { client } = await this.client(actor.organizationId, id);
    let result: { ok: boolean; errorKind: ReturnType<typeof classifyAiError>['kind'] | null; message: string; modelsVisible: number | null };
    try {
      const models = await client.listModels(AbortSignal.timeout(20_000));
      result = { ok: true, errorKind: null, message: models ? `Conexión válida: ${models.length} modelos visibles` : 'Conexión válida', modelsVisible: models?.length ?? null };
    } catch (err) {
      const c = classifyAiError(err);
      const messages: Record<string, string> = {
        auth: 'Credencial rechazada por el proveedor (autenticación)',
        quota: 'El proveedor rechazó la solicitud por cuota o límite de uso',
        network: 'No se pudo conectar con el endpoint (red)',
        model_not_found: 'Endpoint o modelo inexistente',
        timeout: 'El proveedor no respondió a tiempo',
      };
      result = { ok: false, errorKind: c.kind, message: `${messages[c.kind] ?? 'Error del proveedor'}: ${c.message}`, modelsVisible: null };
    }
    await this.deps.db
      .update(providerConnections)
      .set({ status: result.ok ? 'ok' : 'error', lastErrorKind: result.errorKind, lastError: result.ok ? null : result.message.slice(0, 500), lastCheckedAt: new Date() })
      .where(eq(providerConnections.id, id));
    await recordAudit(this.deps.db, actor, {
      action: 'ai.connections.test',
      resourceType: 'provider_connection',
      resourceId: id,
      outcome: result.ok ? 'success' : 'failed',
      metadata: { errorKind: result.errorKind },
    });
    return { ...result, latencyMs: Date.now() - t0 };
  }
}
