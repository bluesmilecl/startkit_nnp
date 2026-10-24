import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AiServices, ChatService } from '@starter/ai';
import type { Actor } from '@starter/auth';
import { AgentDetail, AgentList, AgentTestInput, AgentTestResult, AgentValidation, AgentConfig, CreateAgentInput, IdParams, PublishInput, RollbackInput, SaveDraftInput, UpdateAgentInput } from '@starter/contracts';
import type { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams } from '../../common/endpoint.js';
import { AI } from '../ai/ai.token.js';
import { CHAT } from './chat.token.js';

@ApiTags('ai-agents')
@Controller('ai/agents')
export class AgentsController {
  constructor(
    @Inject(AI) private readonly ai: AiServices,
    @Inject(CHAT) private readonly chat: ChatService,
  ) {}

  @Get()
  @Endpoint({ operationId: 'ai_agents_list', summary: 'Agentes configurables', feature: 'ai', permission: 'ai.agents.manage', response: { schema: AgentList } })
  list(@CurrentActor() actor: Actor) {
    return this.ai.agents.list(actor);
  }

  @Post()
  @Endpoint({ operationId: 'ai_agents_create', summary: 'Crear agente (con un borrador inicial)', feature: 'ai', permission: 'ai.agents.manage', body: CreateAgentInput, response: { status: 201, schema: AgentDetail }, errors: [409] })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateAgentInput>) {
    return this.ai.agents.create(actor, body);
  }

  @Get(':id')
  @Endpoint({ operationId: 'ai_agents_get', summary: 'Agente con historial de versiones', feature: 'ai', permission: 'ai.agents.manage', params: IdParams, response: { schema: AgentDetail }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.ai.agents.get(actor, p.id);
  }

  @Patch(':id')
  @Endpoint({ operationId: 'ai_agents_update', summary: 'Renombrar, marcar como predeterminado o archivar', feature: 'ai', permission: 'ai.agents.manage', params: IdParams, body: UpdateAgentInput, response: { schema: AgentDetail }, errors: [404, 409] })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateAgentInput>) {
    return this.ai.agents.update(actor, p.id, body);
  }

  @Put(':id/draft')
  @Endpoint({
    operationId: 'ai_agents_save_draft',
    summary: 'Guardar borrador',
    description: 'Guarda la configuración en el único borrador del agente (lo crea a partir de la versión publicada si no existe) y la valida contra el catálogo.',
    feature: 'ai',
    permission: 'ai.agents.manage',
    params: IdParams,
    body: SaveDraftInput,
    response: { schema: AgentDetail },
    errors: [404, 412],
  })
  saveDraft(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof SaveDraftInput>) {
    return this.ai.agents.saveDraft(actor, p.id, body);
  }

  @Delete(':id/draft')
  @HttpCode(200)
  @Endpoint({ operationId: 'ai_agents_discard_draft', summary: 'Descartar borrador', feature: 'ai', permission: 'ai.agents.manage', params: IdParams, response: { schema: AgentDetail }, errors: [404, 409] })
  discard(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.ai.agents.discardDraft(actor, p.id);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @Endpoint({ operationId: 'ai_agents_validate', summary: 'Validar una configuración sin guardarla', feature: 'ai', permission: 'ai.agents.manage', params: IdParams, body: AgentConfig, response: { schema: AgentValidation } })
  validate(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof AgentConfig>) {
    return this.ai.agents.validate(actor.organizationId, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Endpoint({ operationId: 'ai_agents_publish', summary: 'Publicar borrador', description: 'Revalida y publica; la versión publicada anterior queda archivada.', feature: 'ai', permission: 'ai.agents.manage', params: IdParams, body: PublishInput, response: { schema: AgentDetail }, errors: [404, 409] })
  publish(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof PublishInput>) {
    return this.ai.agents.publish(actor, p.id, body.versionId, body.notes);
  }

  @Post(':id/rollback')
  @HttpCode(200)
  @Endpoint({ operationId: 'ai_agents_rollback', summary: 'Restaurar una versión archivada', description: 'Publica una copia de la versión elegida como nueva versión.', feature: 'ai', permission: 'ai.agents.manage', params: IdParams, body: RollbackInput, response: { schema: AgentDetail }, errors: [404, 409] })
  rollback(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof RollbackInput>) {
    return this.ai.agents.rollback(actor, p.id, body.versionId);
  }

  @Post(':id/test')
  @HttpCode(200)
  @Endpoint({
    operationId: 'ai_agents_test',
    summary: 'Probar una versión (incluido el borrador)',
    description: 'Ejecuta un mensaje con tus permisos reales; las herramientas sensibles solo crean propuestas. El consumo se registra en el libro.',
    feature: 'ai',
    permission: 'ai.agents.manage',
    params: IdParams,
    body: AgentTestInput,
    response: { schema: AgentTestResult },
    errors: [402, 409, 502],
  })
  test(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof AgentTestInput>) {
    return this.chat.test(actor, p.id, body.versionId, body.message);
  }
}
