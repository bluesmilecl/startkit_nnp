import { Module } from '@nestjs/common';
import type { AiServices } from '@starter/ai';
import type { Env, FeatureFlags, SecretBox } from '@starter/config';
import type { DbHandle } from '@starter/db';
import type { JobQueue } from '@starter/jobs';
import type { ConfiguredMailer } from '@starter/mail';
import { createMessagingServices, type MessagingServices } from '@starter/messaging';
import { DB, ENV, FEATURES, JOBS, MAILER, SECRET_BOX } from '../../infra/tokens.js';
import { AI } from '../ai/ai.token.js';
import { MailAutomationsController, MailDeliveriesController, MailSettingsController, MailTemplatesController } from './mail.controllers.js';
import { MESSAGING } from './mail.token.js';

/** E-mail administration: provider settings, templates (with AI), automations and the delivery log. */
@Module({
  controllers: [MailSettingsController, MailTemplatesController, MailAutomationsController, MailDeliveriesController],
  providers: [
    {
      provide: MESSAGING,
      inject: [DB, ENV, SECRET_BOX, MAILER, JOBS, AI, FEATURES],
      useFactory: (db: DbHandle, env: Env, secrets: SecretBox, mailer: ConfiguredMailer, jobs: JobQueue, ai: AiServices, features: FeatureFlags): MessagingServices =>
        createMessagingServices({ db: db.db, env, secrets, mailer, jobs, ai: features.ai ? ai : undefined }),
    },
  ],
  exports: [MESSAGING],
})
export class MailModule {}
