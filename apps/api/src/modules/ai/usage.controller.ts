import { Controller, Delete, Get, HttpCode, Inject, Post, Put, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AiServices } from '@starter/ai';
import { assertCan, type Actor } from '@starter/auth';
import { AiRequestsPage, AiRequestsQuery, Budget, BudgetInput, BudgetList, IdParams, JobAccepted, OkResponse, UsageQuery, UsageSummary } from '@starter/contracts';
import { JobQueue, QUEUES } from '@starter/jobs';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { toCsv } from '../../common/csv.js';
import { Endpoint, ZBody, ZParams, ZQuery } from '../../common/endpoint.js';
import { JOBS } from '../../infra/tokens.js';
import { AI } from './ai.token.js';

@ApiTags('ai-usage')
@Controller('ai')
export class AiUsageController {
  constructor(
    @Inject(AI) private readonly ai: AiServices,
    @Inject(JOBS) private readonly jobs: JobQueue,
  ) {}

  @Get('usage')
  @Endpoint({
    operationId: 'ai_usage_summary',
    summary: 'Consumo y costos agregados',
    description: 'Separa costo calculado, estimado y conciliado. Las solicitudes sin tarifa conocida se cuentan como costo desconocido (nunca cero). Moneda base USD; la conversión a CLP es solo visual.',
    feature: 'ai',
    permission: 'ai.usage.read',
    query: UsageQuery,
    response: { schema: UsageSummary },
  })
  summary(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof UsageQuery>) {
    return this.ai.usage.summary(actor, q);
  }

  @Get('usage/requests')
  @Endpoint({ operationId: 'ai_usage_requests', summary: 'Libro de consumo (solicitudes lógicas)', feature: 'ai', permission: 'ai.usage.read', query: AiRequestsQuery, response: { schema: AiRequestsPage } })
  requests(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof AiRequestsQuery>) {
    return this.ai.usage.requests(actor, q);
  }

  @Get('usage/export.csv')
  @Endpoint({ operationId: 'ai_usage_export', summary: 'Exportar libro de consumo a CSV (máx. 10.000 filas)', feature: 'ai', permission: 'ai.usage.read', query: AiRequestsQuery, response: { contentType: 'text/csv', rawSchema: { type: 'string' } } })
  async export(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof AiRequestsQuery>, @Res() res: Response) {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= 100; page++) {
      const r = await this.ai.usage.requests(actor, { ...q, page, pageSize: 100 });
      rows.push(...r.items);
      if (page >= r.pageCount) break;
    }
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="ai-usage.csv"');
    res.send(toCsv(rows, ['startedAt', 'feature', 'provider', 'modelId', 'status', 'costStatus', 'costUsd', 'estimatedCostUsd', 'inputTokens', 'outputTokens', 'latencyMs', 'attempts', 'userEmail', 'agentId', 'conversationId', 'requestId']));
  }

  @Get('budgets')
  @Endpoint({ operationId: 'ai_budgets_list', summary: 'Presupuestos y consumo del período', feature: 'ai', response: { schema: BudgetList } })
  budgets(@CurrentActor() actor: Actor) {
    return this.ai.budgets.list(actor);
  }

  @Post('budgets')
  @Endpoint({ operationId: 'ai_budgets_create', summary: 'Crear presupuesto', feature: 'ai', permission: 'ai.budgets.manage', body: BudgetInput, response: { status: 201, schema: Budget } })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof BudgetInput>) {
    return this.ai.budgets.create(actor, body);
  }

  @Put('budgets/:id')
  @Endpoint({ operationId: 'ai_budgets_update', summary: 'Editar presupuesto', feature: 'ai', permission: 'ai.budgets.manage', params: IdParams, body: BudgetInput, response: { schema: Budget }, errors: [404] })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof BudgetInput>) {
    return this.ai.budgets.update(actor, p.id, body);
  }

  @Delete('budgets/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'ai_budgets_delete', summary: 'Eliminar presupuesto', feature: 'ai', permission: 'ai.budgets.manage', params: IdParams, response: { schema: OkResponse }, errors: [404] })
  async remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.ai.budgets.remove(actor, p.id);
    return { ok: true as const };
  }

  @Post('fx/refresh')
  @HttpCode(202)
  @Endpoint({ operationId: 'ai_fx_refresh', summary: 'Actualizar tasa USD→CLP de visualización', description: 'Encola una consulta al proveedor de tipo de cambio configurado (FX_PROVIDER).', feature: 'ai', permission: 'ai.models.manage', response: { status: 202, schema: JobAccepted } })
  async fx(@CurrentActor() actor: Actor) {
    assertCan(actor, 'ai.usage.read');
    const jobId = await this.jobs.send(QUEUES.aiFxRates, { force: true }, { idempotencyKey: 'fx-refresh' });
    return { jobId: jobId ?? '00000000-0000-0000-0000-000000000000', status: jobId ? 'queued' : 'already-queued' };
  }
}
