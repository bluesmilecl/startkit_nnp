import type { Env, FeatureFlags, SecretBox } from '@starter/config';
import type { DbHandle } from '@starter/db';
import type { JobQueue } from '@starter/jobs';
import type { Mailer } from '@starter/mail';
import type { Storage } from '@starter/storage';

/** Shared dependencies for job handlers (same domain packages as the API, no duplicated logic). */
export interface WorkerContext {
  env: Env;
  features: FeatureFlags;
  db: DbHandle;
  jobs: JobQueue;
  mailer: Mailer;
  storage: Storage;
  secrets: SecretBox;
}
