import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettingsService, type Actor } from '@starter/auth';
import { AppSettings, OkResponse, UpdateSettingsInput } from '@starter/contracts';
import type { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody } from '../../common/endpoint.js';

@ApiTags('admin-settings')
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Endpoint({ operationId: 'admin_settings_get', summary: 'Configuración de la instalación', permission: 'settings.read', response: { schema: AppSettings } })
  get(@CurrentActor() actor: Actor) {
    return this.settings.get(actor);
  }

  @Patch()
  @Endpoint({
    operationId: 'admin_settings_update',
    summary: 'Actualizar marca, idioma, zona horaria, registro y retención',
    description: 'El transporte de correo y sus credenciales se configuran en el despliegue (variables de entorno), no aquí.',
    permission: 'settings.update',
    body: UpdateSettingsInput,
    response: { schema: AppSettings },
  })
  update(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof UpdateSettingsInput>) {
    return this.settings.update(actor, body);
  }

  @Post('onboarding/complete')
  @HttpCode(200)
  @Endpoint({ operationId: 'admin_onboarding_complete', summary: 'Marcar onboarding inicial como completado', permission: 'settings.update', response: { schema: OkResponse } })
  async complete(@CurrentActor() actor: Actor) {
    await this.settings.completeOnboarding(actor);
    return { ok: true as const };
  }
}
