import { Controller, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AiServices } from '@starter/ai';
import { assertCan, type Actor } from '@starter/auth';
import { CatalogModel, IdParams, JobAccepted, ManualModelInput, ModelsPage, ModelsQuery, SyncRun, UpdateModelInput, Uuid, VerifyModelResult } from '@starter/contracts';
import { JobQueue, QUEUES } from '@starter/jobs';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams, ZQuery } from '../../common/endpoint.js';
import { JOBS } from '../../infra/tokens.js';
import { AI } from './ai.token.js';

const SyncModelsInput = z.object({ connectionId: Uuid }).meta({ id: 'SyncModelsInput' });
const SyncRunList = z.array(SyncRun).meta({ id: 'SyncRunList' });
const SyncRunsQuery = z.object({ kind: z.enum(['prices', 'models']).optional() });

@ApiTags('ai-models')
@Controller('ai')
export class AiModelsController {
  constructor(
    @Inject(AI) private readonly ai: AiServices,
    @Inject(JOBS) private readonly jobs: JobQueue,
  ) {}

  @Get('models')
  @Endpoint({ operationId: 'ai_models_list', summary: 'Catálogo de modelos con capacidades y tarifas vigentes', description: 'Filtros por nombre, función, capacidad (estado "yes") y disponibilidad. Una capacidad no verificada figura como "unknown".', feature: 'ai', query: ModelsQuery, response: { schema: ModelsPage } })
  list(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof ModelsQuery>) {
    return this.ai.models.list(actor, q);
  }

  @Get('models/:id')
  @Endpoint({ operationId: 'ai_models_get', summary: 'Ficha de modelo', feature: 'ai', params: IdParams, response: { schema: CatalogModel }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.ai.models.get(actor, p.id);
  }

  @Post('models')
  @Endpoint({ operationId: 'ai_models_import', summary: 'Importar modelo manualmente (requiere fuente)', feature: 'ai', permission: 'ai.models.manage', body: ManualModelInput, response: { status: 201, schema: CatalogModel } })
  importManual(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof ManualModelInput>) {
    return this.ai.models.createManual(actor, body);
  }

  @Patch('models/:id')
  @Endpoint({ operationId: 'ai_models_update', summary: 'Habilitar/deshabilitar o corregir capacidades', feature: 'ai', permission: 'ai.models.manage', params: IdParams, body: UpdateModelInput, response: { schema: CatalogModel }, errors: [404] })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateModelInput>) {
    return this.ai.models.update(actor, p.id, body);
  }

  @Post('models/:id/verify')
  @HttpCode(200)
  @Endpoint({
    operationId: 'ai_models_verify',
    summary: 'Verificar disponibilidad con una llamada mínima',
    description: 'Aparecer en un catálogo no implica acceso: esta llamada explícita (con costo registrado) es la única que marca el modelo como disponible.',
    feature: 'ai',
    permission: 'ai.models.manage',
    params: IdParams,
    response: { schema: VerifyModelResult },
    errors: [404, 402],
  })
  verify(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.ai.models.verify(actor, p.id);
  }

  @Post('models/sync')
  @HttpCode(202)
  @Endpoint({ operationId: 'ai_models_sync', summary: 'Sincronizar catálogo de una conexión (trabajo durable)', feature: 'ai', permission: 'ai.models.manage', body: SyncModelsInput, response: { status: 202, schema: JobAccepted } })
  async sync(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof SyncModelsInput>) {
    assertCan(actor, 'ai.models.manage');
    await this.ai.connections.findRow(actor, body.connectionId);
    const jobId = await this.jobs.send(QUEUES.aiSyncModels, { connectionId: body.connectionId, organizationId: actor.organizationId, userId: actor.userId });
    return { jobId: jobId ?? '00000000-0000-0000-0000-000000000000', status: jobId ? 'queued' : 'already-queued' };
  }

  @Get('sync-runs')
  @Endpoint({ operationId: 'ai_sync_runs', summary: 'Ejecuciones recientes de sincronización de modelos y tarifas', feature: 'ai', query: SyncRunsQuery, response: { schema: SyncRunList } })
  runs(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof SyncRunsQuery>) {
    return this.ai.prices.runs(actor, q.kind);
  }
}
