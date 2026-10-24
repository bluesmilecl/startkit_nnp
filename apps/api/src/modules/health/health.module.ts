import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Global()
@Module({ controllers: [HealthController], providers: [HealthService], exports: [HealthService] })
export class HealthModule {}
