import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettingsService } from '@starter/auth';
import type { Env } from '@starter/config';
import { PublicSettings } from '@starter/contracts';
import type { z } from 'zod';
import { Endpoint } from '../../common/endpoint.js';
import { ENV } from '../../infra/tokens.js';

@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('settings')
  @Endpoint({ operationId: 'public_settings', summary: 'Marca y parámetros públicos para la pantalla de acceso', public: true, response: { schema: PublicSettings } })
  async get(): Promise<z.infer<typeof PublicSettings>> {
    const s = await this.settings.getAll();
    return {
      appName: s.branding.appName,
      logoUrl: s.branding.logoUrl,
      primaryColor: s.branding.primaryColor,
      locale: s.locale.locale,
      registration: s.auth.registration,
      otpLength: this.env.OTP_LENGTH,
      otpResendSeconds: this.env.OTP_RESEND_SECONDS,
    };
  }
}
