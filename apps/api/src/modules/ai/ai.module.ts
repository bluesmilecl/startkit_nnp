import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { createAiServices, type AiServices } from '@starter/ai';
import type { AccessDeps } from '@starter/auth';
import type { FeatureFlags, SecretBox } from '@starter/config';
import { agents, and, count, eq, isNotNull, type DbHandle } from '@starter/db';
import { ACCESS_DEPS, DB, FEATURES, SECRET_BOX } from '../../infra/tokens.js';
import { DashboardService } from '../system/dashboard.service.js';
import { AiConnectionsController } from './connections.controller.js';
import { AiModelsController } from './models.controller.js';
import { AiPricesController } from './prices.controller.js';
import { AiUsageController } from './usage.controller.js';
import { AiLabController } from './lab.controller.js';
import { AI } from './ai.token.js';

export { AI };

@Global()
@Module({
  controllers: [AiConnectionsController, AiModelsController, AiPricesController, AiUsageController, AiLabController],
  providers: [
    {
      provide: AI,
      inject: [ACCESS_DEPS, SECRET_BOX],
      useFactory: (deps: AccessDeps, secrets: SecretBox): AiServices => createAiServices({ ...deps, secrets }),
    },
  ],
  exports: [AI],
})
export class AiModule implements OnModuleInit {
  constructor(
    @Inject(AI) private readonly ai: AiServices,
    @Inject(FEATURES) private readonly features: FeatureFlags,
    @Inject(DB) private readonly db: DbHandle,
    private readonly dashboard: DashboardService,
  ) {}

  onModuleInit(): void {
    if (!this.features.ai) return;
    this.dashboard.register(async (actor) => {
      const conns = await this.ai.connections.list(actor).catch(() => []);
      const usage = actor.permissions.has('ai.usage.read') ? await this.ai.usage.last7d(actor.organizationId) : { requests: 0, costUsd: '0', unknown: 0 };
      const [published] = await this.db.db.select({ n: count() }).from(agents).where(and(eq(agents.organizationId, actor.organizationId), isNotNull(agents.publishedVersionId)));
      return {
        ai: {
          configured: (published?.n ?? 0) > 0,
          connections: conns.length,
          agentsPublished: published?.n ?? 0,
          requests7d: usage.requests,
          cost7dUsd: usage.costUsd,
          unknownCostRequests7d: usage.unknown,
        },
      };
    });
  }
}
