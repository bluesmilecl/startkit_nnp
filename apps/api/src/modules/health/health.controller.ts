import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Env } from '@starter/config';
import { HealthStatus } from '@starter/contracts';
import { metrics } from '@starter/observability';
import type { Response } from 'express';
import { z } from 'zod';
import { Endpoint } from '../../common/endpoint.js';
import { ENV } from '../../infra/tokens.js';
import { HealthService } from './health.service.js';

const Live = z.object({ status: z.literal('ok') }).meta({ id: 'LiveStatus' });

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('live')
  @Endpoint({ operationId: 'health_live', summary: 'Proceso vivo', public: true, response: { schema: Live } })
  live(): z.infer<typeof Live> {
    return { status: 'ok' };
  }

  @Get('ready')
  @Endpoint({
    operationId: 'health_ready',
    summary: 'Dependencias requeridas disponibles',
    description: 'Comprueba base de datos y migraciones. pgvector solo se verifica si RAG está habilitado y activo.',
    public: true,
    response: { schema: HealthStatus },
    extraResponses: [{ status: 503, schema: HealthStatus, description: 'No listo' }],
  })
  async ready(@Res({ passthrough: true }) res: Response): Promise<z.infer<typeof HealthStatus>> {
    const status = await this.health.readiness();
    if (status.status === 'error') res.status(503);
    return status;
  }

  @Get('metrics')
  @Endpoint({
    operationId: 'health_metrics',
    summary: 'Métricas en formato Prometheus',
    permission: 'system.diagnostics',
    response: { contentType: 'text/plain', rawSchema: { type: 'string' } },
  })
  metrics(@Res() res: Response): void {
    res.type('text/plain').send(metrics.render());
  }
}
