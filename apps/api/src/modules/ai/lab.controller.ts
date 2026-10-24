import { Controller, Get, Inject, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AiServices } from '@starter/ai';
import type { Actor } from '@starter/auth';
import { IdParams, LabRun, LabRunInput, LabRunList, RecommendationInput, RecommendationResult } from '@starter/contracts';
import { JobQueue, QUEUES } from '@starter/jobs';
import type { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams } from '../../common/endpoint.js';
import { JOBS } from '../../infra/tokens.js';
import { AI } from './ai.token.js';

@ApiTags('ai-lab')
@Controller('ai')
export class AiLabController {
  constructor(
    @Inject(AI) private readonly ai: AiServices,
    @Inject(JOBS) private readonly jobs: JobQueue,
  ) {}

  @Post('recommendations')
  @Endpoint({
    operationId: 'ai_recommendations_create',
    summary: 'Recomendar modelos para un caso de uso',
    description: 'Filtra candidatos con requisitos verificables y puntuación determinista; si se indica un evaluador configurado, este solo ordena esos candidatos (respuesta validada, IDs ajenos rechazados) y su costo queda registrado.',
    feature: 'ai',
    permission: 'ai.lab.use',
    body: RecommendationInput,
    response: { status: 201, schema: RecommendationResult },
    errors: [402],
  })
  recommend(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof RecommendationInput>) {
    return this.ai.recommendation.recommend(actor, body);
  }

  @Post('lab/runs')
  @Endpoint({
    operationId: 'ai_lab_create',
    summary: 'Comparar modelos con un conjunto de prompts (trabajo durable)',
    description: 'Ejecuta en el worker bajo un presupuesto y concurrencia máximos; registra latencia, tiempo hasta el primer token, consumo y costo de cada llamada.',
    feature: 'ai',
    permission: 'ai.lab.use',
    body: LabRunInput,
    response: { status: 201, schema: LabRun },
  })
  async create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof LabRunInput>) {
    const run = await this.ai.lab.create(actor, body);
    await this.jobs.send(QUEUES.aiLabRun, { runId: run.id }, { idempotencyKey: `lab:${run.id}` });
    return this.ai.lab.get(actor, run.id);
  }

  @Get('lab/runs')
  @Endpoint({ operationId: 'ai_lab_list', summary: 'Ejecuciones recientes del laboratorio', feature: 'ai', permission: 'ai.lab.use', response: { schema: LabRunList } })
  list(@CurrentActor() actor: Actor) {
    return this.ai.lab.list(actor);
  }

  @Get('lab/runs/:id')
  @Endpoint({ operationId: 'ai_lab_get', summary: 'Resultados de una ejecución', feature: 'ai', permission: 'ai.lab.use', params: IdParams, response: { schema: LabRun }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.ai.lab.get(actor, p.id);
  }
}
