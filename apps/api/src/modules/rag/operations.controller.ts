import { Controller, Delete, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Actor } from '@starter/auth';
import {
  EvaluationRun,
  EvaluationRunInput,
  EvaluationRunList,
  EvaluationSet,
  EvaluationSetInput,
  EvaluationSetList,
  IdParams,
  OkResponse,
  RagAnalytics,
  RagAnalyticsQuery,
  RagJob,
  RagJobsPage,
  RagJobsQuery,
  RateEvaluationInput,
  SearchRequest,
  SearchResult,
} from '@starter/contracts';
import type { RagServices } from '@starter/rag';
import type { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams, ZQuery } from '../../common/endpoint.js';
import { RAG } from './rag.token.js';

@ApiTags('rag-operations')
@Controller('rag')
export class RagOperationsController {
  constructor(@Inject(RAG) private readonly rag: RagServices) {}

  @Get('jobs')
  @Endpoint({ operationId: 'rag_jobs_list', summary: 'Trabajos de indexación con etapa, progreso y costo', feature: 'rag', permission: 'rag.jobs.manage', query: RagJobsQuery, response: { schema: RagJobsPage } })
  jobs(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof RagJobsQuery>) {
    return this.rag.jobs.list(actor, q);
  }

  @Get('jobs/:id')
  @Endpoint({ operationId: 'rag_jobs_get', summary: 'Trabajo', feature: 'rag', permission: 'rag.jobs.manage', params: IdParams, response: { schema: RagJob }, errors: [404] })
  job(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.jobs.get(actor, p.id);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  @Endpoint({ operationId: 'rag_jobs_cancel', summary: 'Cancelar (en cola: inmediato; en curso: en el siguiente punto seguro)', feature: 'rag', permission: 'rag.jobs.manage', params: IdParams, response: { schema: RagJob }, errors: [404, 409] })
  cancel(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.jobs.cancel(actor, p.id);
  }

  @Post('jobs/:id/retry')
  @HttpCode(200)
  @Endpoint({ operationId: 'rag_jobs_retry', summary: 'Reintentar trabajo fallido o cancelado', feature: 'rag', permission: 'rag.jobs.manage', params: IdParams, response: { schema: RagJob }, errors: [404, 409] })
  retry(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.jobs.retry(actor, p.id);
  }

  @Post('search')
  @HttpCode(200)
  @Endpoint({
    operationId: 'rag_search',
    summary: 'Laboratorio de búsqueda',
    description: 'Búsqueda vectorial, de texto completo o híbrida (RRF) sobre las colecciones autorizadas; registra la ejecución para analítica.',
    feature: 'rag',
    permission: 'rag.playground.use',
    body: SearchRequest,
    response: { schema: SearchResult },
  })
  search(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof SearchRequest>) {
    return this.rag.retrieval.search(actor, { ...body, origin: 'playground', management: true });
  }

  @Get('evaluations')
  @Endpoint({ operationId: 'rag_evaluations_list', summary: 'Conjuntos de evaluación', feature: 'rag', permission: 'rag.playground.use', response: { schema: EvaluationSetList } })
  evaluations(@CurrentActor() actor: Actor) {
    return this.rag.retrieval.evaluationSets(actor);
  }

  @Post('evaluations')
  @Endpoint({ operationId: 'rag_evaluations_create', summary: 'Crear conjunto de evaluación', feature: 'rag', permission: 'rag.playground.use', body: EvaluationSetInput, response: { status: 201, schema: EvaluationSet } })
  createEvaluation(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof EvaluationSetInput>) {
    return this.rag.retrieval.saveEvaluationSet(actor, null, body);
  }

  @Put('evaluations/:id')
  @Endpoint({ operationId: 'rag_evaluations_update', summary: 'Editar conjunto de evaluación', feature: 'rag', permission: 'rag.playground.use', params: IdParams, body: EvaluationSetInput, response: { schema: EvaluationSet }, errors: [404] })
  updateEvaluation(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof EvaluationSetInput>) {
    return this.rag.retrieval.saveEvaluationSet(actor, p.id, body);
  }

  @Delete('evaluations/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'rag_evaluations_delete', summary: 'Eliminar conjunto de evaluación', feature: 'rag', permission: 'rag.playground.use', params: IdParams, response: { schema: OkResponse } })
  async deleteEvaluation(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.rag.retrieval.deleteEvaluationSet(actor, p.id);
    return { ok: true as const };
  }

  @Get('evaluations/:id/runs')
  @Endpoint({ operationId: 'rag_evaluations_runs', summary: 'Resultados por configuración (recall@k, latencia, costo)', feature: 'rag', permission: 'rag.playground.use', params: IdParams, response: { schema: EvaluationRunList }, errors: [404] })
  runs(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.retrieval.evaluationRuns(actor, p.id);
  }

  @Post('evaluations/:id/runs')
  @Endpoint({ operationId: 'rag_evaluations_run', summary: 'Ejecutar evaluación con una configuración', feature: 'rag', permission: 'rag.playground.use', params: IdParams, body: EvaluationRunInput, response: { status: 201, schema: EvaluationRun }, errors: [404] })
  run(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof EvaluationRunInput>) {
    return this.rag.retrieval.runEvaluation(actor, p.id, body);
  }

  @Post('evaluations/:id/ratings')
  @HttpCode(200)
  @Endpoint({ operationId: 'rag_evaluations_rate', summary: 'Calificación humana de un caso', feature: 'rag', permission: 'rag.playground.use', params: IdParams, body: RateEvaluationInput, response: { schema: OkResponse }, errors: [404] })
  async rate(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof RateEvaluationInput>) {
    await this.rag.retrieval.rateEvaluation(actor, p.id, body);
    return { ok: true as const };
  }

  @Get('analytics')
  @Endpoint({ operationId: 'rag_analytics', summary: 'Analítica de conocimiento (consultas, abstención, latencia, ingesta, costos, retroalimentación)', feature: 'rag', permission: 'rag.analytics.read', query: RagAnalyticsQuery, response: { schema: RagAnalytics } })
  analytics(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof RagAnalyticsQuery>) {
    return this.rag.retrieval.analytics(actor, q);
  }
}
