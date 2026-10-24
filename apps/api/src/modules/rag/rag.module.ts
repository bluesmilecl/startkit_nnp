import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import type { AiServices, ChatService } from '@starter/ai';
import type { AccessDeps } from '@starter/auth';
import type { FeatureFlags, SecretBox } from '@starter/config';
import { and, count, eq, inArray, ragCollections, ragJobs, type DbHandle } from '@starter/db';
import type { JobQueue } from '@starter/jobs';
import { createRagServices, type RagServices } from '@starter/rag';
import type { Storage } from '@starter/storage';
import { ACCESS_DEPS, DB, FEATURES, JOBS, SECRET_BOX, STORAGE } from '../../infra/tokens.js';
import { AgentsModule } from '../agents/agents.module.js';
import { CHAT } from '../agents/chat.token.js';
import { AI } from '../ai/ai.token.js';
import { DashboardService } from '../system/dashboard.service.js';
import { RagCollectionsController } from './collections.controller.js';
import { RagConnectionsController } from './connections.controller.js';
import { RagOperationsController } from './operations.controller.js';
import { RAG } from './rag.token.js';

@Module({
  imports: [AgentsModule],
  controllers: [RagConnectionsController, RagCollectionsController, RagOperationsController],
  providers: [
    {
      provide: RAG,
      inject: [ACCESS_DEPS, SECRET_BOX, STORAGE, JOBS, AI],
      useFactory: (deps: AccessDeps, secrets: SecretBox, storage: Storage, jobs: JobQueue, ai: AiServices) => createRagServices({ ...deps, secrets, storage, jobs, ai }),
    },
  ],
  exports: [RAG],
})
export class RagModule implements OnModuleInit {
  constructor(
    @Inject(RAG) private readonly rag: RagServices,
    @Inject(CHAT) private readonly chat: ChatService,
    @Inject(FEATURES) private readonly features: FeatureFlags,
    @Inject(DB) private readonly db: DbHandle,
    private readonly dashboard: DashboardService,
  ) {}

  onModuleInit(): void {
    if (!this.features.rag) return;
    // The chat retrieves through the same ACL-aware service as the panel.
    this.chat.setKnowledgeProvider(this.rag.retrieval.knowledgeProvider());
    this.dashboard.register(async (actor) => {
      const page = await this.rag.collections.list(actor, { page: 1, pageSize: 100 }).catch(() => null);
      const [running] = await this.db.db
        .select({ n: count() })
        .from(ragJobs)
        .where(and(eq(ragJobs.organizationId, actor.organizationId), inArray(ragJobs.status, ['queued', 'running', 'retrying'])));
      const [collections] = await this.db.db.select({ n: count() }).from(ragCollections).where(eq(ragCollections.organizationId, actor.organizationId));
      return {
        rag: {
          enabled: true,
          collections: collections?.n ?? 0,
          documents: page?.items.reduce((s, c) => s + c.stats.documents, 0) ?? 0,
          runningJobs: running?.n ?? 0,
        },
      };
    });
  }
}
