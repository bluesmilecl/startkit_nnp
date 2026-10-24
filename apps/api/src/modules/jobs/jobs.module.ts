import { Global, Inject, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { SettingsService } from '@starter/auth';
import type { Env } from '@starter/config';
import { JobQueue, QUEUES } from '@starter/jobs';
import { createStorage, type Storage } from '@starter/storage';
import { ENV, JOBS, STORAGE } from '../../infra/tokens.js';
import { AccessEventsService } from '../auth/access-events.service.js';
import { HealthService } from '../health/health.service.js';
import { DiagnosticsService } from '../system/diagnostics.service.js';

@Global()
@Module({
  providers: [
    {
      provide: JOBS,
      inject: [ENV],
      useFactory: (env: Env) => JobQueue.create({ connectionString: env.DATABASE_URL, role: 'api' }),
    },
    { provide: STORAGE, inject: [ENV], useFactory: (env: Env) => createStorage(env) },
  ],
  exports: [JOBS, STORAGE],
})
export class JobsModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(JOBS) private readonly jobs: JobQueue,
    @Inject(STORAGE) private readonly storage: Storage,
    private readonly health: HealthService,
    private readonly diagnostics: DiagnosticsService,
    private readonly settings: SettingsService,
    private readonly events: AccessEventsService,
  ) {}

  onModuleInit(): void {
    this.health.register(async () => {
      const heartbeat = await this.settings.getRaw<{ at: string }>('worker.heartbeat');
      const age = heartbeat ? (Date.now() - new Date(heartbeat.at).getTime()) / 1000 : null;
      return {
        worker: age !== null && age < 180 ? { status: 'ok', detail: `latido hace ${Math.round(age)} s` } : { status: 'degraded', detail: heartbeat ? `sin latido desde hace ${Math.round(age!)} s` : 'aún sin latido' },
      };
    });
    this.diagnostics.register(async () => {
      const stats = await this.jobs.stats();
      const heartbeat = await this.settings.getRaw<{ at: string }>('worker.heartbeat');
      return {
        jobs: { queued: stats.queued, active: stats.active, failed24h: stats.failed, workerSeenAt: heartbeat?.at ?? null },
        storage: { driver: this.storage.driver, ...(await this.storage.check()) },
      };
    });
    this.events.on(async (e) => {
      if (e.type === 'user.deleted' && e.storageKeys.length) {
        await this.jobs.send(QUEUES.storagePurge, { keys: e.storageKeys, reason: `user ${e.userId} deleted` });
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.jobs.stop(true);
  }
}
