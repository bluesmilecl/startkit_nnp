import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AiServices } from '@starter/ai';
import { assertCan, type Actor } from '@starter/auth';
import { CreatePriceInput, JobAccepted, PricesPage, PricesQuery } from '@starter/contracts';
import { JobQueue, QUEUES } from '@starter/jobs';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZQuery } from '../../common/endpoint.js';
import { JOBS } from '../../infra/tokens.js';
import { AI } from './ai.token.js';

const SetPriceResult = z.object({ result: z.enum(['unchanged', 'created', 'updated']) }).meta({ id: 'SetPriceResult' });

@ApiTags('ai-prices')
@Controller('ai/prices')
export class AiPricesController {
  constructor(
    @Inject(AI) private readonly ai: AiServices,
    @Inject(JOBS) private readonly jobs: JobQueue,
  ) {}

  @Get()
  @Endpoint({ operationId: 'ai_prices_list', summary: 'Tarifas vigentes (o historial)', description: 'Cada tarifa conserva fuente, fecha de consulta, vigencia, moneda, unidad y ámbito de facturación. Requiere ai.models.manage o ai.usage.read (verificado en el servicio).', feature: 'ai', query: PricesQuery, response: { schema: PricesPage } })
  list(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof PricesQuery>) {
    return this.ai.prices.list(actor, q);
  }

  @Post()
  @Endpoint({
    operationId: 'ai_prices_set',
    summary: 'Registrar tarifa manual o acuerdo personalizado',
    description: 'Una nueva tarifa cierra la vigencia de la anterior; el historial y las estimaciones ya calculadas no se recalculan.',
    feature: 'ai',
    permission: 'ai.models.manage',
    body: CreatePriceInput,
    response: { status: 201, schema: SetPriceResult },
  })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreatePriceInput>) {
    return this.ai.prices.create(actor, body);
  }

  @Post('sync')
  @HttpCode(202)
  @Endpoint({ operationId: 'ai_prices_sync', summary: 'Sincronizar tarifas desde el catálogo estructurado (trabajo durable)', feature: 'ai', permission: 'ai.models.manage', response: { status: 202, schema: JobAccepted } })
  async sync(@CurrentActor() actor: Actor) {
    assertCan(actor, 'ai.models.manage');
    const jobId = await this.jobs.send(QUEUES.aiSyncPrices, { userId: actor.userId }, { idempotencyKey: 'prices-sync' });
    return { jobId: jobId ?? '00000000-0000-0000-0000-000000000000', status: jobId ? 'queued' : 'already-queued' };
  }
}
