import { SettingsService, recordAudit, systemActor } from '@starter/auth';
import { actionProposals, and, auditEvents, conversations, eq, lt, retrievalRuns, sql } from '@starter/db';
import { QUEUES } from '@starter/jobs';
import { createLogger, sanitizeError } from '@starter/observability';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkerContext } from '../context.js';

const log = createLogger('worker-system');

export async function registerSystemHandlers(ctx: WorkerContext): Promise<void> {
  const settings = new SettingsService({ db: ctx.db.db, env: ctx.env, features: ctx.features, mailer: ctx.mailer });

  await ctx.jobs.work(QUEUES.workerHeartbeat, async () => {
    const stats = await ctx.jobs.stats();
    await settings.setRaw('worker.heartbeat', { at: new Date().toISOString(), pid: process.pid, ...stats }, null);
  });

  await ctx.jobs.work(QUEUES.maintenance, async () => {
    const db = ctx.db.db;
    const expired = await db
      .update(actionProposals)
      .set({ status: 'expired' })
      .where(and(eq(actionProposals.status, 'pending'), lt(actionProposals.expiresAt, new Date())))
      .returning({ id: actionProposals.id });
    const retention = await settings.retention();
    let conversationsPurged = 0;
    let queriesPurged = 0;
    let auditPurged = 0;
    if (retention.conversationsDays) {
      const rows = await db
        .delete(conversations)
        .where(lt(conversations.updatedAt, sql`now() - make_interval(days => ${retention.conversationsDays})`))
        .returning({ id: conversations.id });
      conversationsPurged = rows.length;
    }
    if (retention.retrievalQueriesDays) {
      const rows = await db
        .update(retrievalRuns)
        .set({ query: null })
        .where(and(lt(retrievalRuns.createdAt, sql`now() - make_interval(days => ${retention.retrievalQueriesDays})`), sql`${retrievalRuns.query} is not null`))
        .returning({ id: retrievalRuns.id });
      queriesPurged = rows.length;
    }
    if (retention.auditDays) {
      // Audit retention is an explicit policy: the purge itself is recorded, never silent.
      const rows = await db
        .delete(auditEvents)
        .where(lt(auditEvents.occurredAt, sql`now() - make_interval(days => ${retention.auditDays})`))
        .returning({ id: auditEvents.id });
      auditPurged = rows.length;
      if (auditPurged) {
        await recordAudit(db, systemActor(), {
          action: 'audit.retention.purge',
          resourceType: 'audit',
          outcome: 'success',
          organizationId: null,
          metadata: { purged: auditPurged, olderThanDays: retention.auditDays },
        });
      }
    }
    for (const hook of maintenanceHooks) await hook(ctx);
    log.info({ expiredProposals: expired.length, conversationsPurged, queriesPurged, auditPurged }, 'maintenance done');
  });

  await ctx.jobs.work(QUEUES.versionCheck, async () => {
    await settings.setRaw('diagnostics.versions', await checkVersions(), null);
  });
}

type MaintenanceHook = (ctx: WorkerContext) => Promise<void>;
const maintenanceHooks: MaintenanceHook[] = [];
/** Modules (AI budgets, RAG) add their own periodic housekeeping. */
export function onMaintenance(hook: MaintenanceHook): void {
  maintenanceHooks.push(hook);
}

/** Latest stable versions for the tracked stack (informative; never installs anything). */
export async function checkVersions() {
  const manifestPath = resolve(process.cwd(), 'starter.manifest.json');
  const stack: Record<string, string> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).stack : {};
  const packages: Record<string, { latest: string | null; error?: string }> = {};
  for (const name of Object.keys(stack)) {
    try {
      const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      packages[name] = { latest: ((await res.json()) as { version: string }).version };
    } catch (err) {
      packages[name] = { latest: null, error: sanitizeError(err, 120) };
    }
  }
  let latestLts: string | null = null;
  let current: string | null = null;
  try {
    const res = await fetch('https://nodejs.org/dist/index.json', { signal: AbortSignal.timeout(10_000) });
    const list = (await res.json()) as { version: string; lts: string | false }[];
    latestLts = list.find((r) => r.lts)?.version.replace(/^v/, '') ?? null;
    current = list[0]?.version.replace(/^v/, '') ?? null;
  } catch {
    /* recorded as null */
  }
  return { checkedAt: new Date().toISOString(), packages, node: { latestLts, current } };
}
