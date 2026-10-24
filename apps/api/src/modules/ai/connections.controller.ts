import { Controller, Delete, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AiServices } from '@starter/ai';
import type { Actor } from '@starter/auth';
import { Connection, ConnectionTestResult, CreateConnectionInput, IdParams, OkResponse, ProviderInfo, UpdateConnectionInput } from '@starter/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams } from '../../common/endpoint.js';
import { AI } from './ai.token.js';

const ConnectionList = z.array(Connection).meta({ id: 'ConnectionList' });
const ProviderList = z.array(ProviderInfo).meta({ id: 'ProviderList' });

@ApiTags('ai-connections')
@Controller('ai')
export class AiConnectionsController {
  constructor(@Inject(AI) private readonly ai: AiServices) {}

  @Get('providers')
  @Endpoint({ operationId: 'ai_providers_list', summary: 'Adaptadores de proveedores disponibles', feature: 'ai', response: { schema: ProviderList } })
  providers() {
    return this.ai.connections.providers();
  }

  @Get('connections')
  @Endpoint({ operationId: 'ai_connections_list', summary: 'Conexiones a proveedores (credenciales enmascaradas)', feature: 'ai', response: { schema: ConnectionList } })
  list(@CurrentActor() actor: Actor) {
    return this.ai.connections.list(actor);
  }

  @Post('connections')
  @Endpoint({
    operationId: 'ai_connections_create',
    summary: 'Crear conexión',
    description: 'La clave se guarda cifrada (AES-256-GCM, clave de aplicación fuera de la base de datos) o se referencia a un secreto del despliegue (env:/file:). Los endpoints personalizados se validan contra redes privadas y metadatos.',
    feature: 'ai',
    permission: 'ai.providers.manage',
    body: CreateConnectionInput,
    response: { status: 201, schema: Connection },
    errors: [409],
  })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateConnectionInput>) {
    return this.ai.connections.create(actor, body);
  }

  @Get('connections/:id')
  @Endpoint({ operationId: 'ai_connections_get', summary: 'Detalle de conexión', feature: 'ai', params: IdParams, response: { schema: Connection }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.ai.connections.get(actor, p.id);
  }

  @Patch('connections/:id')
  @Endpoint({ operationId: 'ai_connections_update', summary: 'Editar o rotar credencial', feature: 'ai', permission: 'ai.providers.manage', params: IdParams, body: UpdateConnectionInput, response: { schema: Connection }, errors: [404] })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateConnectionInput>) {
    return this.ai.connections.update(actor, p.id, body);
  }

  @Delete('connections/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'ai_connections_delete', summary: 'Eliminar conexión', feature: 'ai', permission: 'ai.providers.manage', params: IdParams, response: { schema: OkResponse }, errors: [404, 409] })
  async remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.ai.connections.remove(actor, p.id);
    return { ok: true as const };
  }

  @Post('connections/:id/test')
  @HttpCode(200)
  @Endpoint({
    operationId: 'ai_connections_test',
    summary: 'Probar conexión',
    description: 'Lista modelos con la credencial (sin costo) y clasifica errores: autenticación, cuota, red o endpoint/modelo inexistente.',
    feature: 'ai',
    permission: 'ai.providers.manage',
    params: IdParams,
    response: { schema: ConnectionTestResult },
    errors: [404],
  })
  test(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.ai.connections.test(actor, p.id);
  }
}
