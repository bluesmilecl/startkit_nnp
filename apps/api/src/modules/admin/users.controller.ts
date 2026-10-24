import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UsersService, type Actor } from '@starter/auth';
import {
  AssignRoleInput,
  CreateUserInput,
  DisableUserInput,
  IdParams,
  UpdateUserInput,
  UserDetail,
  UsersListQuery,
  UsersPage,
  Uuid,
} from '@starter/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams, ZQuery } from '../../common/endpoint.js';

const UserRoleParams = z.object({ id: Uuid, roleId: Uuid });
const RoleScopeQuery = z.object({ organizationId: Uuid.optional() });
const UpdateUserBody = UpdateUserInput.extend({ expectedVersion: z.string().optional() }).meta({ id: 'UpdateUserBody' });
const DeleteResult = z.object({ purgedFiles: z.number().int() }).meta({ id: 'DeleteUserResult' });
const RevokeResult = z.object({ revoked: z.number().int() }).meta({ id: 'RevokeSessionsResult' });

@ApiTags('admin-users')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Endpoint({
    operationId: 'admin_users_list',
    summary: 'Listar usuarios con filtros y paginación',
    permission: 'users.read',
    query: UsersListQuery,
    response: { schema: UsersPage },
  })
  list(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof UsersListQuery>) {
    return this.users.list(actor, q);
  }

  @Get(':id')
  @Endpoint({ operationId: 'admin_users_get', summary: 'Detalle de usuario', permission: 'users.read', params: IdParams, response: { schema: UserDetail }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.users.get(actor, p.id);
  }

  @Post()
  @Endpoint({
    operationId: 'admin_users_create',
    summary: 'Crear usuario',
    description: 'Crea la cuenta (sin contraseña: ingresa por código OTP). Asignar roles requiere `roles.manage`; enviar invitación requiere `users.invite`.',
    permission: 'users.create',
    body: CreateUserInput,
    response: { status: 201, schema: UserDetail },
    errors: [409],
  })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateUserInput>) {
    return this.users.create(actor, body);
  }

  @Patch(':id')
  @Endpoint({
    operationId: 'admin_users_update',
    summary: 'Editar datos del usuario',
    permission: 'users.update',
    params: IdParams,
    body: UpdateUserBody,
    response: { schema: UserDetail },
    errors: [404, 412],
  })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateUserBody>) {
    const { expectedVersion, ...input } = body;
    return this.users.update(actor, p.id, input, expectedVersion);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @Endpoint({
    operationId: 'admin_users_disable',
    summary: 'Desactivar usuario y revocar sus sesiones',
    permission: 'users.disable',
    params: IdParams,
    body: DisableUserInput,
    response: { schema: UserDetail },
    errors: [404, 412],
  })
  disable(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof DisableUserInput>) {
    return this.users.disable(actor, p.id, body.reason);
  }

  @Post(':id/enable')
  @HttpCode(200)
  @Endpoint({ operationId: 'admin_users_enable', summary: 'Reactivar usuario', permission: 'users.disable', params: IdParams, response: { schema: UserDetail }, errors: [404] })
  enable(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.users.enable(actor, p.id);
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  @Endpoint({ operationId: 'admin_users_revoke_sessions', summary: 'Revocar todas las sesiones del usuario', permission: 'users.disable', params: IdParams, response: { schema: RevokeResult }, errors: [404] })
  revokeSessions(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.users.revokeSessions(actor, p.id);
  }

  @Delete(':id')
  @HttpCode(200)
  @Endpoint({
    operationId: 'admin_users_delete',
    summary: 'Eliminar usuario',
    description:
      'Revoca el acceso, elimina membresías, roles, conversaciones y archivos personales (purga programada). La auditoría y el registro de costos se conservan con identificadores seudónimos. Protege al último propietario.',
    permission: 'users.delete',
    params: IdParams,
    response: { schema: DeleteResult },
    errors: [404, 412],
  })
  remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.users.delete(actor, p.id);
  }

  @Post(':id/roles')
  @HttpCode(200)
  @Endpoint({
    operationId: 'admin_users_assign_role',
    summary: 'Asignar rol al usuario',
    description: 'Autorización delegable: no se pueden asignar roles de jerarquía igual o superior a la propia; el rol propietario solo lo asigna un propietario; no se permite autoasignación.',
    permission: 'roles.manage',
    params: IdParams,
    body: AssignRoleInput,
    response: { schema: UserDetail },
    errors: [404],
  })
  assignRole(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof AssignRoleInput>) {
    return this.users.assignRole(actor, p.id, body.roleId, body.organizationId);
  }

  @Delete(':id/roles/:roleId')
  @HttpCode(200)
  @Endpoint({
    operationId: 'admin_users_remove_role',
    summary: 'Quitar rol al usuario',
    permission: 'roles.manage',
    params: UserRoleParams,
    query: RoleScopeQuery,
    response: { schema: UserDetail },
    errors: [404, 412],
  })
  removeRole(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof UserRoleParams>, @ZQuery() q: z.infer<typeof RoleScopeQuery>) {
    return this.users.removeRole(actor, p.id, p.roleId, q.organizationId ?? null);
  }
}
