import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { featureFlags, getEnv, SecretBox, type Env, type FeatureFlags } from '@starter/config';
import { createDb, type DbHandle } from '@starter/db';
import { createMailer } from '@starter/mail';
import { DB, ENV, FEATURES, MAILER, SECRET_BOX } from './tokens.js';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => getEnv() },
    { provide: FEATURES, inject: [ENV], useFactory: (env: Env): FeatureFlags => featureFlags(env) },
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env): DbHandle =>
        createDb(env.DATABASE_URL, { max: env.DATABASE_POOL_MAX, ssl: env.DATABASE_SSL, applicationName: 'starter-api' }),
    },
    {
      provide: SECRET_BOX,
      inject: [ENV],
      useFactory: (env: Env) => new SecretBox(env.APP_ENCRYPTION_KEY, env.APP_ENCRYPTION_PREVIOUS_KEYS),
    },
    { provide: MAILER, inject: [ENV], useFactory: (env: Env) => createMailer(env) },
  ],
  exports: [ENV, DB, SECRET_BOX, MAILER, FEATURES],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}
