import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvitationsService, type Actor } from '@starter/auth';
import { CreateInvitationInput, IdParams, InvitationsPage, InvitationSummary, OkResponse, PageQuery } from '@starter/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams, ZQuery } from '../../common/endpoint.js';

const InvitationsQuery = PageQuery.extend({ status: z.enum(['pending', 'accepted', 'revoked', 'expired']).optional() });

@ApiTags('admin-invitations')
@Controller('admin/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @Endpoint({ operationId: 'admin_invitations_list', summary: 'Listar invitaciones', permission: 'users.invite', query: InvitationsQuery, response: { schema: InvitationsPage } })
  list(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof InvitationsQuery>) {
    return this.invitations.list(actor, q);
  }

  @Post()
  @Endpoint({
    operationId: 'admin_invitations_create',
    summary: 'Invitar por correo',
    description: 'Envía un correo de invitación. Al ingresar con el código OTP se aplica el rol indicado.',
    permission: 'users.invite',
    body: CreateInvitationInput,
    response: { status: 201, schema: InvitationSummary },
    errors: [409, 502],
  })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateInvitationInput>) {
    return this.invitations.create(actor, body);
  }

  @Post(':id/resend')
  @HttpCode(200)
  @Endpoint({ operationId: 'admin_invitations_resend', summary: 'Reenviar invitación', permission: 'users.invite', params: IdParams, response: { schema: OkResponse }, errors: [409, 502] })
  async resend(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.invitations.resend(actor, p.id);
    return { ok: true as const };
  }

  @Delete(':id')
  @HttpCode(200)
  @Endpoint({ operationId: 'admin_invitations_revoke', summary: 'Revocar invitación', permission: 'users.invite', params: IdParams, response: { schema: OkResponse }, errors: [404, 409] })
  async revoke(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.invitations.revoke(actor, p.id);
    return { ok: true as const };
  }
}
