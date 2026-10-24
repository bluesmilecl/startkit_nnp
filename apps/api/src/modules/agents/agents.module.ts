import { Module } from '@nestjs/common';
import { createChatService, type AiServices } from '@starter/ai';
import { ProposalsService, type AccessDeps } from '@starter/auth';
import type { SecretBox } from '@starter/config';
import { JobQueue, QUEUES } from '@starter/jobs';
import type { Storage } from '@starter/storage';
import { ACCESS_DEPS, JOBS, SECRET_BOX, STORAGE } from '../../infra/tokens.js';
import { AI } from '../ai/ai.token.js';
import { AgentsController } from './agents.controller.js';
import { ChatController } from './chat.controller.js';
import { CHAT } from './chat.token.js';

@Module({
  controllers: [AgentsController, ChatController],
  providers: [
    {
      provide: CHAT,
      inject: [ACCESS_DEPS, SECRET_BOX, STORAGE, ProposalsService, JOBS, AI],
      useFactory: (deps: AccessDeps, secrets: SecretBox, storage: Storage, proposals: ProposalsService, jobs: JobQueue, ai: AiServices) =>
        createChatService(
          {
            ...deps,
            secrets,
            storage,
            proposals,
            purgeFiles: async (keys, reason) => {
              await jobs.send(QUEUES.storagePurge, { keys, reason });
            },
          },
          ai,
        ),
    },
  ],
  exports: [CHAT],
})
export class AgentsModule {}
