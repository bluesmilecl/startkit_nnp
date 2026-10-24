import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { InfraModule } from './infra/infra.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AgentsModule } from './modules/agents/agents.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CsrfMiddleware } from './modules/auth/csrf.middleware.js';
import { HealthModule } from './modules/health/health.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { SystemModule } from './modules/system/system.module.js';

@Module({
  imports: [InfraModule, HealthModule, AuthModule, SystemModule, JobsModule, AdminModule, AiModule, AgentsModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
    consumer.apply(CsrfMiddleware).forRoutes('{*path}');
  }
}
