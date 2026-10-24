import { Global, Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { DiagnosticsService } from './diagnostics.service.js';
import { SystemController } from './system.controller.js';

@Global()
@Module({ controllers: [SystemController], providers: [DashboardService, DiagnosticsService], exports: [DashboardService, DiagnosticsService] })
export class SystemModule {}
