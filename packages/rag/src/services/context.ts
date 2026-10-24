import type { AiDeps, AiServices } from '@starter/ai';
import { assertAllowedEndpoint } from '@starter/ai';
import { resolveSecretRef } from '@starter/config';
import { AppError } from '@starter/contracts';
import { type ragConnections } from '@starter/db';
import type { JobQueue } from '@starter/jobs';
import type { Storage } from '@starter/storage';
import { ApiStore } from '../store/api-store.js';
import { createPgPool, PgVectorStore } from '../store/pg-store.js';
import type { RagStore, StoreCapabilities } from '../store/types.js';

export interface RagDeps extends AiDeps {
  storage: Storage;
  jobs: JobQueue | null;
  ai: AiServices;
}

export type ConnectionRow = typeof ragConnections.$inferSelect;

/** Secret of a connection (stored encrypted or referenced), never returned by the API. */
export function connectionSecret(deps: RagDeps, row: ConnectionRow): string | null {
  if (row.credentialCiphertext) return deps.secrets.decrypt(row.credentialCiphertext);
  if (row.credentialRef) return resolveSecretRef(row.credentialRef);
  return null;
}

/** DDL-capable URL for the internal store (migration role when configured). */
export function internalDdlUrl(deps: RagDeps): string {
  return deps.env.DATABASE_MIGRATION_URL || deps.env.DATABASE_URL;
}

/**
 * One store (and connection pool) per RAG connection and configuration revision. Internal
 * stores reuse the application database with the least-privilege runtime role.
 */
export class StoreRegistry {
  private readonly cache = new Map<string, { rev: string; store: RagStore }>();

  constructor(private readonly deps: RagDeps) {}

  get(row: ConnectionRow): RagStore {
    const rev = `${row.updatedAt.getTime()}`;
    const hit = this.cache.get(row.id);
    if (hit && hit.rev === rev) return hit.store;
    if (hit) void hit.store.close().catch(() => {});
    const store = this.create(row);
    this.cache.set(row.id, { rev, store });
    return store;
  }

  private create(row: ConnectionRow): RagStore {
    const config = row.config as { schema?: string; baseUrl?: string; externalRefs?: Record<string, string> };
    const readOnly = row.access === 'read-only';
    if (row.kind === 'internal') {
      const pool = createPgPool(this.deps.env.DATABASE_URL, { ssl: this.deps.env.DATABASE_SSL, max: 5, timeoutMs: row.timeoutMs, applicationName: 'starter-rag' });
      return new PgVectorStore(pool, { kind: 'internal', schema: config.schema ?? 'rag', readOnly });
    }
    if (row.kind === 'postgres') {
      const url = connectionSecret(this.deps, row);
      if (!url) throw new AppError('NOT_CONFIGURED', 'La conexión PostgreSQL no tiene cadena de conexión');
      const pool = createPgPool(url, { ssl: row.tls, max: 5, timeoutMs: row.timeoutMs, applicationName: 'starter-rag' });
      return new PgVectorStore(pool, { kind: 'postgres', schema: config.schema ?? 'rag', readOnly });
    }
    if (row.kind === 'api') {
      if (!config.baseUrl) throw new AppError('NOT_CONFIGURED', 'La conexión API no tiene URL base');
      const allowPrivate = this.deps.env.RAG_FETCH_ALLOW_PRIVATE;
      const caps = row.capabilities as unknown as StoreCapabilities | null;
      return new ApiStore({
        baseUrl: config.baseUrl,
        token: connectionSecret(this.deps, row),
        timeoutMs: row.timeoutMs,
        externalRefs: new Map(Object.entries(config.externalRefs ?? {})),
        assertUrl: async (u) => {
          await assertAllowedEndpoint(u, { allowPrivate });
        },
        capabilities: caps && Object.keys(caps).length ? caps : null,
      });
    }
    throw new AppError('VALIDATION_FAILED', `Tipo de conexión desconocido: ${row.kind}`);
  }

  async closeAll(): Promise<void> {
    for (const { store } of this.cache.values()) await store.close().catch(() => {});
    this.cache.clear();
  }
}
