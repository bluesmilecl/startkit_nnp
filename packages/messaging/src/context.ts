import type { AiServices } from '@starter/ai';
import type { Env, SecretBox } from '@starter/config';
import type { Database } from '@starter/db';
import type { JobQueue } from '@starter/jobs';
import type { ConfiguredMailer } from '@starter/mail';

/** Shared dependencies of the mail administration services (API and worker). */
export interface MessagingDeps {
  db: Database;
  env: Env;
  secrets: SecretBox;
  mailer: ConfiguredMailer;
  /** Queues automation sends; required where automations are created or ticked. */
  jobs?: JobQueue;
  /** Template generation with AI (only when the AI module is enabled). */
  ai?: AiServices;
}
