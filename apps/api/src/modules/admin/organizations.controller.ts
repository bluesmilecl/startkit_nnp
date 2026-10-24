import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrganizationsService, type Actor } from '@starter/auth';
import { AddMemberInput, CreateOrganizationInput, IdParams, OkResponse, OrganizationSummary, Uuid } from '@starter/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams } from '../../common/endpoint.js';

const OrgList = z.array(OrganizationSummary).meta({ id: 'OrganizationList' });
const Member = z.object({ id: Uuid, email: z.string(), name: z.string(), joinedAt: z.iso.datetime({ offset: true }) });
const MemberList = z.array(Member).meta({ id: 'OrganizationMemberList' });
const MemberParams = z.object({ id: Uuid, userId: Uuid });

@ApiTags('admin-organizations')
@Controller('admin/organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get()
  @Endpoint({ operationId: 'admin_orgs_list', summary: 'Listar organizaciones', feature: 'organizations', permission: 'organizations.read', response: { schema: OrgList } })
  list(@CurrentActor() actor: Actor) {
    return this.orgs.list(actor);
  }

  @Post()
  @Endpoint({
    operationId: 'admin_orgs_create',
    summary: 'Crear organización',
    feature: 'organizations',
    permission: 'organizations.manage',
    body: CreateOrganizationInput,
    response: { status: 201, schema: OrganizationSummary },
    errors: [409],
  })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateOrganizationInput>) {
    return this.orgs.create(actor, body);
  }

  @Get(':id/members')
  @Endpoint({ operationId: 'admin_orgs_members', summary: 'Miembros de una organización', feature: 'organizations', permission: 'organizations.read', params: IdParams, response: { schema: MemberList }, errors: [404] })
  async members(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    const rows = await this.orgs.members(actor, p.id);
    return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
  }

  @Post(':id/members')
  @HttpCode(200)
  @Endpoint({ operationId: 'admin_orgs_add_member', summary: 'Agregar miembro', feature: 'organizations', permission: 'organizations.manage', params: IdParams, body: AddMemberInput, response: { schema: OkResponse }, errors: [404] })
  async add(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof AddMemberInput>) {
    await this.orgs.addMember(actor, p.id, body.userId);
    return { ok: true as const };
  }

  @Delete(':id/members/:userId')
  @HttpCode(200)
  @Endpoint({ operationId: 'admin_orgs_remove_member', summary: 'Quitar miembro', feature: 'organizations', permission: 'organizations.manage', params: MemberParams, response: { schema: OkResponse }, errors: [404, 412] })
  async remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof MemberParams>) {
    await this.orgs.removeMember(actor, p.id, p.userId);
    return { ok: true as const };
  }
}
