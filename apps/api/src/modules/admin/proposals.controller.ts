import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProposalsService, type Actor } from '@starter/auth';
import { ActionProposal, ConfirmProposalResult, IdParams } from '@starter/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams } from '../../common/endpoint.js';

const CreateProposalInput = z
  .object({
    action: z.enum([
      'users.delete',
      'users.disable',
      'users.assignRole',
      'users.removeRole',
      'users.changeRole',
      'roles.setPermissions',
      'roles.delete',
      'roles.create',
    ]),
    args: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'CreateProposalInput' });

@ApiTags('admin-action-proposals')
@Controller('admin/action-proposals')
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Post()
  @Endpoint({
    operationId: 'admin_proposals_create',
    summary: 'Previsualizar una acción sensible',
    description:
      'Construye la vista previa (objetivo, antes/después y efectos) aplicando las mismas comprobaciones de autorización que la ejecución, y la guarda con vencimiento y uso único. No modifica nada.',
    body: CreateProposalInput,
    response: { status: 201, schema: ActionProposal },
    errors: [404, 409],
  })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateProposalInput>) {
    return this.proposals.propose(actor, body.action, body.args, { source: 'panel' });
  }

  @Get(':id')
  @Endpoint({ operationId: 'admin_proposals_get', summary: 'Estado de una propuesta propia', params: IdParams, response: { schema: ActionProposal }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.proposals.get(actor, p.id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Endpoint({
    operationId: 'admin_proposals_confirm',
    summary: 'Confirmar y ejecutar una propuesta',
    description:
      'Revalida sesión, permisos, versión del recurso, integridad de argumentos y vencimiento. Es idempotente: una segunda confirmación devuelve el resultado ya ejecutado sin repetir el cambio.',
    params: IdParams,
    response: { schema: ConfirmProposalResult },
    errors: [404, 409, 410, 412],
  })
  async confirm(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    const r = await this.proposals.confirm(actor, p.id);
    return { proposal: r.proposal, href: r.href };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Endpoint({ operationId: 'admin_proposals_cancel', summary: 'Cancelar una propuesta', params: IdParams, response: { schema: ActionProposal }, errors: [404, 409] })
  cancel(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.proposals.cancel(actor, p.id);
  }
}
