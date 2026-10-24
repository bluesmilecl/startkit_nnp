import { Controller, Delete, Get, HttpCode, Inject, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Actor } from '@starter/auth';
import {
  CreateMailTemplateInput,
  GeneratedMailTemplate,
  GenerateMailTemplateInput,
  IdParams,
  MailAutomation,
  MailAutomationInput,
  MailAutomationList,
  MailCheck,
  MailCheckInput,
  MailDeliveriesPage,
  MailDeliveriesQuery,
  MailProviderSettings,
  MailTemplate,
  MailTemplateSummary,
  MailTemplateTestInput,
  MailTestInput,
  MailTestResult,
  OkResponse,
  UpdateMailAutomationInput,
  UpdateMailProviderInput,
  UpdateMailTemplateInput,
} from '@starter/contracts';
import type { MessagingServices } from '@starter/messaging';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams, ZQuery } from '../../common/endpoint.js';
import { MESSAGING } from './mail.token.js';

const MailTemplateList = z.array(MailTemplateSummary).meta({ id: 'MailTemplateList' });
const TestTo = z.object({ to: z.email('Correo inválido') }).meta({ id: 'MailTestTo' });

@ApiTags('mail')
@Controller('admin/mail/settings')
export class MailSettingsController {
  constructor(@Inject(MESSAGING) private readonly mail: MessagingServices) {}

  @Get()
  @Endpoint({ operationId: 'mail_settings_get', summary: 'Proveedor de correo en uso', description: 'Configurado en la plataforma (base de datos) o por variables MAIL_*. El secreto nunca se devuelve, solo una pista.', permission: 'mail.read', response: { schema: MailProviderSettings } })
  get(@CurrentActor() actor: Actor) {
    return this.mail.settings.get(actor);
  }

  @Put()
  @Endpoint({
    operationId: 'mail_settings_update',
    summary: 'Guardar proveedor de correo',
    description: 'La API key o contraseña SMTP se cifra con APP_ENCRYPTION_KEY; omitirla conserva la guardada (mismo proveedor). Requiere la versión leída (412 si cambió).',
    permission: 'mail.manage',
    body: UpdateMailProviderInput,
    response: { schema: MailProviderSettings },
    errors: [412],
  })
  update(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof UpdateMailProviderInput>) {
    return this.mail.settings.update(actor, body);
  }

  @Delete()
  @HttpCode(200)
  @Endpoint({ operationId: 'mail_settings_reset', summary: 'Volver a las variables de entorno', description: 'Elimina la configuración guardada (incluido el secreto).', permission: 'mail.manage', response: { schema: MailProviderSettings } })
  reset(@CurrentActor() actor: Actor) {
    return this.mail.settings.reset(actor);
  }

  @Post('check')
  @HttpCode(200)
  @Endpoint({ operationId: 'mail_settings_check', summary: 'Comprobar credenciales sin enviar', description: 'Con `draft` prueba los valores del formulario antes de guardarlos.', permission: 'mail.manage', body: MailCheckInput, response: { schema: MailCheck } })
  check(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof MailCheckInput>) {
    return this.mail.settings.check(actor, body);
  }

  @Post('test')
  @HttpCode(200)
  @Endpoint({ operationId: 'mail_settings_test', summary: 'Enviar un correo de prueba', description: 'Devuelve el resultado del proveedor (ok: false con el motivo si lo rechaza).', permission: 'mail.manage', body: MailTestInput, response: { schema: MailTestResult } })
  test(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof MailTestInput>) {
    return this.mail.settings.test(actor, body);
  }
}

@ApiTags('mail')
@Controller('admin/mail/templates')
export class MailTemplatesController {
  constructor(@Inject(MESSAGING) private readonly mail: MessagingServices) {}

  @Get()
  @Endpoint({ operationId: 'mail_templates_list', summary: 'Plantillas de correo', permission: 'mail.read', response: { schema: MailTemplateList } })
  list(@CurrentActor() actor: Actor) {
    return this.mail.templates.list(actor);
  }

  @Post()
  @Endpoint({ operationId: 'mail_templates_create', summary: 'Crear plantilla', permission: 'mail.manage', body: CreateMailTemplateInput, response: { status: 201, schema: MailTemplate }, errors: [409] })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateMailTemplateInput>) {
    return this.mail.templates.create(actor, body);
  }

  @Post('generate')
  @HttpCode(200)
  @Endpoint({
    operationId: 'mail_templates_generate',
    summary: 'Generar asunto y HTML con IA',
    description: 'Usa el modelo indicado o el del asistente predeterminado; el costo queda en el libro de uso (función mail_template). No guarda nada.',
    permission: 'mail.manage',
    feature: 'ai',
    body: GenerateMailTemplateInput,
    response: { schema: GeneratedMailTemplate },
    errors: [502, 503],
  })
  generate(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof GenerateMailTemplateInput>) {
    return this.mail.templates.generate(actor, body);
  }

  @Get(':id')
  @Endpoint({ operationId: 'mail_templates_get', summary: 'Plantilla', permission: 'mail.read', params: IdParams, response: { schema: MailTemplate }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.mail.templates.get(actor, p.id);
  }

  @Patch(':id')
  @Endpoint({ operationId: 'mail_templates_update', summary: 'Editar plantilla', permission: 'mail.manage', params: IdParams, body: UpdateMailTemplateInput, response: { schema: MailTemplate }, errors: [404, 412] })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateMailTemplateInput>) {
    return this.mail.templates.update(actor, p.id, body);
  }

  @Post(':id/reset')
  @HttpCode(200)
  @Endpoint({ operationId: 'mail_templates_reset', summary: 'Restablecer plantilla del sistema', permission: 'mail.manage', params: IdParams, response: { schema: MailTemplate }, errors: [404, 409] })
  reset(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.mail.templates.reset(actor, p.id);
  }

  @Post(':id/test')
  @HttpCode(200)
  @Endpoint({ operationId: 'mail_templates_test', summary: 'Enviar la plantilla guardada a un correo', permission: 'mail.manage', params: IdParams, body: MailTemplateTestInput, response: { schema: MailTestResult }, errors: [404] })
  test(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof MailTemplateTestInput>) {
    return this.mail.templates.sendTest(actor, p.id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @Endpoint({ operationId: 'mail_templates_delete', summary: 'Eliminar plantilla propia', permission: 'mail.manage', params: IdParams, response: { schema: OkResponse }, errors: [404, 409] })
  async remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.mail.templates.remove(actor, p.id);
    return { ok: true as const };
  }
}

@ApiTags('mail')
@Controller('admin/mail/automations')
export class MailAutomationsController {
  constructor(@Inject(MESSAGING) private readonly mail: MessagingServices) {}

  @Get()
  @Endpoint({ operationId: 'mail_automations_list', summary: 'Automatizaciones de correo', permission: 'mail.read', response: { schema: MailAutomationList } })
  list(@CurrentActor() actor: Actor) {
    return this.mail.automations.list(actor);
  }

  @Post()
  @Endpoint({ operationId: 'mail_automations_create', summary: 'Crear automatización', description: 'Se dispara con una acción auditada (MAIL_EVENTS) o con una programación cron (UTC). Solo considera eventos posteriores a su activación.', permission: 'mail.manage', body: MailAutomationInput, response: { status: 201, schema: MailAutomation }, errors: [409] })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof MailAutomationInput>) {
    return this.mail.automations.create(actor, body);
  }

  @Get(':id')
  @Endpoint({ operationId: 'mail_automations_get', summary: 'Automatización', permission: 'mail.read', params: IdParams, response: { schema: MailAutomation }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.mail.automations.get(actor, p.id);
  }

  @Patch(':id')
  @Endpoint({ operationId: 'mail_automations_update', summary: 'Editar, activar o desactivar automatización', permission: 'mail.manage', params: IdParams, body: UpdateMailAutomationInput, response: { schema: MailAutomation }, errors: [404, 409, 412] })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateMailAutomationInput>) {
    return this.mail.automations.update(actor, p.id, body);
  }

  @Post(':id/test')
  @HttpCode(200)
  @Endpoint({ operationId: 'mail_automations_test', summary: 'Enviar la automatización con valores de ejemplo', permission: 'mail.manage', params: IdParams, body: TestTo, response: { schema: MailTestResult }, errors: [404] })
  test(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof TestTo>) {
    return this.mail.automations.test(actor, p.id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @Endpoint({ operationId: 'mail_automations_delete', summary: 'Eliminar automatización', permission: 'mail.manage', params: IdParams, response: { schema: OkResponse }, errors: [404] })
  async remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.mail.automations.remove(actor, p.id);
    return { ok: true as const };
  }
}

@ApiTags('mail')
@Controller('admin/mail/deliveries')
export class MailDeliveriesController {
  constructor(@Inject(MESSAGING) private readonly mail: MessagingServices) {}

  @Get()
  @Endpoint({ operationId: 'mail_deliveries_list', summary: 'Envíos de correo', description: 'Sistema, pruebas y automatizaciones. No guarda asuntos (pueden contener códigos).', permission: 'mail.read', query: MailDeliveriesQuery, response: { schema: MailDeliveriesPage } })
  list(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof MailDeliveriesQuery>) {
    return this.mail.deliveries.list(actor, q);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Endpoint({ operationId: 'mail_deliveries_retry', summary: 'Reintentar un envío fallido de automatización', permission: 'mail.manage', params: IdParams, response: { schema: OkResponse }, errors: [404, 409] })
  retry(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.mail.deliveries.retry(actor, p.id);
  }
}
