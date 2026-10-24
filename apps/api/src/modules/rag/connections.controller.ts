import { Controller, Delete, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Actor } from '@starter/auth';
import { CreateEmbeddingProfileInput, CreateRagConnectionInput, EmbeddingProfile, EmbeddingProfileList, IdParams, OkResponse, RagConnection, RagConnectionList, UpdateRagConnectionInput } from '@starter/contracts';
import type { RagServices } from '@starter/rag';
import type { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams } from '../../common/endpoint.js';
import { RAG } from './rag.token.js';

@ApiTags('rag-connections')
@Controller('rag')
export class RagConnectionsController {
  constructor(@Inject(RAG) private readonly rag: RagServices) {}

  @Get('connections')
  @Endpoint({ operationId: 'rag_connections_list', summary: 'Conexiones de conocimiento (interna, PostgreSQL externo, API)', feature: 'rag', response: { schema: RagConnectionList } })
  list(@CurrentActor() actor: Actor) {
    return this.rag.connections.list(actor);
  }

  @Post('connections')
  @Endpoint({
    operationId: 'rag_connections_create',
    summary: 'Crear conexión de conocimiento',
    description: 'Las credenciales (cadena de conexión o token) se guardan cifradas o se referencian a secretos del despliegue y nunca se devuelven.',
    feature: 'rag',
    permission: 'rag.collections.manage',
    body: CreateRagConnectionInput,
    response: { status: 201, schema: RagConnection },
    errors: [409],
  })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateRagConnectionInput>) {
    return this.rag.connections.create(actor, body);
  }

  @Get('connections/:id')
  @Endpoint({ operationId: 'rag_connections_get', summary: 'Conexión de conocimiento', feature: 'rag', permission: 'rag.collections.manage', params: IdParams, response: { schema: RagConnection }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.connections.get(actor, p.id);
  }

  @Patch('connections/:id')
  @Endpoint({ operationId: 'rag_connections_update', summary: 'Editar o rotar credencial', feature: 'rag', permission: 'rag.collections.manage', params: IdParams, body: UpdateRagConnectionInput, response: { schema: RagConnection }, errors: [404] })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateRagConnectionInput>) {
    return this.rag.connections.update(actor, p.id, body);
  }

  @Delete('connections/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'rag_connections_delete', summary: 'Eliminar conexión sin colecciones', feature: 'rag', permission: 'rag.collections.manage', params: IdParams, response: { schema: OkResponse }, errors: [404, 409] })
  async remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.rag.connections.remove(actor, p.id);
    return { ok: true as const };
  }

  @Post('connections/:id/diagnose')
  @HttpCode(200)
  @Endpoint({ operationId: 'rag_connections_diagnose', summary: 'Diagnóstico de solo lectura (pgvector, esquema, privilegios, capacidades)', feature: 'rag', permission: 'rag.collections.manage', params: IdParams, response: { schema: RagConnection }, errors: [404] })
  diagnose(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.connections.diagnose(actor, p.id);
  }

  @Post('connections/:id/activate')
  @HttpCode(200)
  @Endpoint({
    operationId: 'rag_connections_activate',
    summary: 'Preparar el almacén (extensión, esquema, migraciones, permisos)',
    description: 'Solo en conexiones administradas por el starter. Si falta un privilegio, el diagnóstico devuelve los pasos manuales exactos.',
    feature: 'rag',
    permission: 'rag.collections.manage',
    params: IdParams,
    response: { schema: RagConnection },
    errors: [404],
  })
  activate(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.connections.activate(actor, p.id);
  }

  @Get('profiles')
  @Endpoint({ operationId: 'rag_profiles_list', summary: 'Perfiles de embeddings', feature: 'rag', response: { schema: EmbeddingProfileList } })
  profiles(@CurrentActor() actor: Actor) {
    return this.rag.profiles.list(actor);
  }

  @Post('profiles')
  @Endpoint({ operationId: 'rag_profiles_create', summary: 'Crear perfil de embeddings', feature: 'rag', permission: 'rag.collections.manage', body: CreateEmbeddingProfileInput, response: { status: 201, schema: EmbeddingProfile }, errors: [409] })
  createProfile(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateEmbeddingProfileInput>) {
    return this.rag.profiles.create(actor, body);
  }

  @Delete('profiles/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'rag_profiles_delete', summary: 'Eliminar perfil sin uso', feature: 'rag', permission: 'rag.collections.manage', params: IdParams, response: { schema: OkResponse }, errors: [404, 409] })
  async removeProfile(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.rag.profiles.remove(actor, p.id);
    return { ok: true as const };
  }
}
