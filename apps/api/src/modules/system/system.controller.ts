import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Actor } from '@starter/auth';
import { DashboardSummary, Diagnostics } from '@starter/contracts';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint } from '../../common/endpoint.js';
import { DashboardService } from './dashboard.service.js';
import { DiagnosticsService } from './diagnostics.service.js';

@ApiTags('admin-system')
@Controller('admin')
export class SystemController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly diagnostics: DiagnosticsService,
  ) {}

  @Get('dashboard')
  @Endpoint({
    operationId: 'admin_dashboard',
    summary: 'Resumen del inicio (secciones según permisos)',
    response: { schema: DashboardSummary },
  })
  summary(@CurrentActor() actor: Actor) {
    return this.dashboard.summary(actor);
  }

  @Get('diagnostics')
  @Endpoint({
    operationId: 'admin_diagnostics',
    summary: 'Diagnóstico de versiones, base de datos, trabajos, correo y almacenamiento',
    description: 'Vista informativa: compara versiones instaladas con la última estable detectada por el trabajo de comprobación. No ejecuta actualizaciones.',
    permission: 'system.diagnostics',
    response: { schema: Diagnostics },
  })
  diag() {
    return this.diagnostics.get();
  }
}
