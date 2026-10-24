import { Controller, Delete, Get, HttpCode, Inject, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrganizationsService, SessionsService, SettingsService, type Actor } from '@starter/auth';
import type { FeatureFlags } from '@starter/config';
import { IdParams, Me, OkResponse, SessionSummary, SwitchOrganizationInput, UpdateProfileInput } from '@starter/contracts';
import { eq, users, type DbHandle } from '@starter/db';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams } from '../../common/endpoint.js';
import { DB, FEATURES } from '../../infra/tokens.js';

const SessionList = z.array(SessionSummary).meta({ id: 'SessionList' });
const RevokedCount = z.object({ revoked: z.number().int() }).meta({ id: 'RevokedCount' });

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly orgs: OrganizationsService,
    private readonly settings: SettingsService,
    @Inject(DB) private readonly db: DbHandle,
    @Inject(FEATURES) private readonly features: FeatureFlags,
  ) {}

  @Get()
  @Endpoint({ operationId: 'me_get', summary: 'Usuario actual, organización, roles y permisos efectivos', response: { schema: Me } })
  async me(@CurrentActor() actor: Actor): Promise<z.infer<typeof Me>> {
    const [u] = await this.db.db.select().from(users).where(eq(users.id, actor.userId));
    const organizations = await this.orgs.listMine(actor);
    const settings = await this.settings.getAll();
    const current = organizations.find((o) => o.id === actor.organizationId) ?? organizations[0];
    return {
      user: { id: u!.id, email: u!.email, name: u!.name, image: u!.image, locale: u!.locale, timezone: u!.timezone },
      organization: current ?? { id: actor.organizationId, name: 'Espacio principal', slug: 'default', isDefault: true },
      organizations,
      roles: actor.roles.map((r) => ({ id: r.id, key: r.key, name: r.name, organizationId: r.organizationId })),
      permissions: [...actor.permissions].sort(),
      features: this.features,
      onboardingRequired: actor.permissions.has('settings.update') && !settings.onboardingCompletedAt,
    };
  }

  @Patch()
  @Endpoint({ operationId: 'me_update', summary: 'Actualizar el perfil propio', body: UpdateProfileInput, response: { schema: OkResponse } })
  async update(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof UpdateProfileInput>) {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.locale !== undefined) patch.locale = body.locale;
    if (body.timezone !== undefined) patch.timezone = body.timezone;
    if (Object.keys(patch).length) await this.db.db.update(users).set(patch).where(eq(users.id, actor.userId));
    return { ok: true as const };
  }

  @Get('sessions')
  @Endpoint({ operationId: 'me_sessions_list', summary: 'Sesiones propias activas', response: { schema: SessionList } })
  listSessions(@CurrentActor() actor: Actor) {
    return this.sessions.listOwn(actor);
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'me_sessions_revoke', summary: 'Revocar una sesión propia', params: IdParams, response: { schema: OkResponse }, errors: [404] })
  async revoke(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.sessions.revokeOwn(actor, p.id);
    return { ok: true as const };
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  @Endpoint({ operationId: 'me_sessions_revoke_others', summary: 'Cerrar todas las demás sesiones propias', response: { schema: RevokedCount } })
  revokeOthers(@CurrentActor() actor: Actor) {
    return this.sessions.revokeOtherOwn(actor);
  }

  @Post('organization')
  @HttpCode(200)
  @Endpoint({
    operationId: 'me_switch_organization',
    summary: 'Cambiar la organización activa de la sesión',
    feature: 'organizations',
    body: SwitchOrganizationInput,
    response: { schema: OkResponse },
  })
  async switchOrg(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof SwitchOrganizationInput>) {
    await this.orgs.switchActive(actor, body.organizationId);
    return { ok: true as const };
  }
}
