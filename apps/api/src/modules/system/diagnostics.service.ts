import { Inject, Injectable } from '@nestjs/common';
import { SettingsService } from '@starter/auth';
import type { Env, FeatureFlags } from '@starter/config';
import type { Diagnostics } from '@starter/contracts';
import { sql, type DbHandle } from '@starter/db';
import type { Mailer } from '@starter/mail';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { DB, ENV, FEATURES, MAILER } from '../../infra/tokens.js';
import { STARTER_VERSION } from '../health/health.service.js';

type Diag = z.infer<typeof Diagnostics>;

interface Manifest {
  version: string;
  runtime: { node: { lts: string; supported: string[] } };
  stack: Record<string, string>;
}

export interface VersionCheck {
  checkedAt: string;
  packages: Record<string, { latest: string | null; error?: string }>;
  node: { latestLts: string | null; current: string | null };
}

export type DiagnosticsContributor = () => Promise<Partial<Pick<Diag, 'storage' | 'jobs'>>>;

/** Reads starter.manifest.json from the repository/image root. */
export function readManifest(): Manifest | null {
  const candidates = [
    resolve(process.cwd(), 'starter.manifest.json'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../starter.manifest.json'),
  ];
  for (const c of candidates) if (existsSync(c)) return JSON.parse(readFileSync(c, 'utf8')) as Manifest;
  return null;
}

function semverGt(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/**
 * Informative diagnostics: installed versions vs. latest stable detected by the worker's version
 * check job. Never installs anything inside the container.
 */
@Injectable()
export class DiagnosticsService {
  private readonly contributors: DiagnosticsContributor[] = [];
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(ENV) private readonly env: Env,
    @Inject(FEATURES) private readonly features: FeatureFlags,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly settings: SettingsService,
  ) {}

  register(c: DiagnosticsContributor): void {
    this.contributors.push(c);
  }

  async get(): Promise<Diag> {
    const manifest = readManifest();
    const check = await this.settings.getRaw<VersionCheck>('diagnostics.versions');
    const db = this.db.db;
    const [ver] = (await db.execute<{ v: string }>(sql`select current_setting('server_version') as v`)).rows;
    const [vec] = (
      await db.execute<{ installed: string | null; available: string | null }>(
        sql`select (select extversion from pg_extension where extname = 'vector') as installed, (select default_version from pg_available_extensions where name = 'vector') as available`,
      )
    ).rows;
    const [mig] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from public.__migrations`)).rows;
    const nodeMajor = process.versions.node.split('.')[0]!;
    const dependencies = Object.entries(manifest?.stack ?? {}).map(([name, installed]) => {
      const latest = check?.packages[name]?.latest ?? null;
      return {
        name,
        installed,
        latest,
        checkedAt: check?.checkedAt ?? null,
        updateAvailable: latest ? semverGt(latest, installed) : null,
        support: null as string | null,
      };
    });
    const latestLts = check?.node.latestLts ?? null;
    dependencies.unshift({
      name: 'node',
      installed: process.versions.node,
      latest: latestLts,
      checkedAt: check?.checkedAt ?? null,
      updateAvailable: latestLts ? semverGt(latestLts, process.versions.node) : null,
      support: process.release.lts ? `LTS ${process.release.lts}` : 'Current (no LTS)',
    });
    const mail = await this.mailer.verify();
    const base: Diag = {
      starterVersion: manifest?.version ?? STARTER_VERSION,
      node: {
        version: process.versions.node,
        lts: process.release.lts ?? null,
        supported: (manifest?.runtime.node.supported ?? ['24']).includes(nodeMajor),
      },
      database: { version: ver?.v ?? 'unknown', pgvector: vec?.installed ?? (vec?.available ? `disponible ${vec.available} (no instalada)` : null), migrations: mig?.n ?? 0 },
      jobs: { queued: 0, active: 0, failed24h: 0, workerSeenAt: null },
      dependencies,
      features: this.features,
      mail: { transport: this.mailer.transport, ok: mail.ok, detail: mail.detail },
      storage: { driver: this.env.STORAGE_DRIVER, ok: true, detail: null },
    };
    for (const c of this.contributors) Object.assign(base, await c());
    return base;
  }
}
