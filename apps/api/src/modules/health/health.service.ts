import { Inject, Injectable } from '@nestjs/common';
import { sql, type DbHandle } from '@starter/db';
import type { HealthStatus } from '@starter/contracts';
import type { z } from 'zod';
import { DB } from '../../infra/tokens.js';

type Health = z.infer<typeof HealthStatus>;
type Check = Health['checks'][string];

export type ReadinessContributor = () => Promise<Record<string, Check>>;

const startedAt = Date.now();
export const STARTER_VERSION = process.env.STARTER_VERSION ?? '0.1.0';

@Injectable()
export class HealthService {
  private readonly contributors: ReadinessContributor[] = [];

  constructor(@Inject(DB) private readonly db: DbHandle) {}

  /** Other modules (jobs, rag) add optional checks that never make a disabled feature required. */
  register(contributor: ReadinessContributor): void {
    this.contributors.push(contributor);
  }

  async readiness(): Promise<Health> {
    const checks: Record<string, Check> = {};
    const t0 = Date.now();
    try {
      await this.db.db.execute(sql`select 1`);
      checks.database = { status: 'ok', latencyMs: Date.now() - t0 };
    } catch (err) {
      checks.database = { status: 'error', detail: (err as Error).message.slice(0, 200) };
    }
    if (checks.database.status === 'ok') {
      try {
        const rows = await this.db.db.execute<{ n: number }>(sql`select count(*)::int as n from public.__migrations`);
        checks.migrations = { status: (rows.rows[0]?.n ?? 0) > 0 ? 'ok' : 'error', detail: `${rows.rows[0]?.n ?? 0} aplicadas` };
      } catch {
        checks.migrations = { status: 'error', detail: 'Falta la tabla de migraciones; ejecuta el servicio migrate' };
      }
      for (const c of this.contributors) {
        try {
          Object.assign(checks, await c());
        } catch (err) {
          checks.contributor = { status: 'degraded', detail: (err as Error).message.slice(0, 200) };
        }
      }
    }
    const values = Object.values(checks);
    const status: Health['status'] = values.some((c) => c.status === 'error')
      ? 'error'
      : values.some((c) => c.status === 'degraded')
        ? 'degraded'
        : 'ok';
    return { status, checks, version: STARTER_VERSION, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) };
  }
}
