import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesService, type Actor } from '@starter/auth';
import {
  CreateRoleInput,
  IdParams,
  OkResponse,
  Permission,
  PermissionMatrix,
  RoleDetail,
  RoleSummary,
  SetRolePermissionsInput,
  UpdateRoleInput,
} from '@starter/contracts';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams } from '../../common/endpoint.js';

const RoleList = z.array(RoleSummary).meta({ id: 'RoleList' });
const PermissionList = z.array(Permission).meta({ id: 'PermissionList' });

@ApiTags('admin-roles')
@Controller('admin')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  @Endpoint({ operationId: 'admin_roles_list', summary: 'Listar roles', permission: 'roles.read', response: { schema: RoleList } })
  list(@CurrentActor() actor: Actor) {
    return this.roles.list(actor);
  }

  @Get('roles/:id')
  @Endpoint({ operationId: 'admin_roles_get', summary: 'Detalle de rol con permisos', permission: 'roles.read', params: IdParams, response: { schema: RoleDetail }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.roles.get(actor, p.id);
  }

  @Post('roles')
  @Endpoint({
    operationId: 'admin_roles_create',
    summary: 'Crear rol',
    description: 'La jerarquía debe ser menor a la del actor (salvo propietarios) y solo se pueden incluir permisos delegables.',
    permission: 'roles.manage',
    body: CreateRoleInput,
    response: { status: 201, schema: RoleDetail },
    errors: [409],
  })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateRoleInput>) {
    return this.roles.create(actor, body);
  }

  @Patch('roles/:id')
  @Endpoint({
    operationId: 'admin_roles_update',
    summary: 'Editar rol',
    permission: 'roles.manage',
    params: IdParams,
    body: UpdateRoleInput,
    response: { schema: RoleDetail },
    errors: [404, 412],
  })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateRoleInput>) {
    return this.roles.update(actor, p.id, body);
  }

  @Delete('roles/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'admin_roles_delete', summary: 'Eliminar rol sin asignaciones', permission: 'roles.manage', params: IdParams, response: { schema: OkResponse }, errors: [404, 409] })
  async remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.roles.delete(actor, p.id);
    return { ok: true as const };
  }

  @Put('roles/:id/permissions')
  @Endpoint({
    operationId: 'admin_roles_set_permissions',
    summary: 'Reemplazar permisos del rol',
    description: 'Solo se pueden conceder permisos que el actor posee; los permisos sensibles requieren propietario. El rol propietario es inmutable.',
    permission: 'permissions.manage',
    params: IdParams,
    body: SetRolePermissionsInput,
    response: { schema: RoleDetail },
    errors: [404, 412],
  })
  setPermissions(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof SetRolePermissionsInput>) {
    return this.roles.setPermissions(actor, p.id, body.permissions, body.expectedVersion);
  }

  @Get('permissions')
  @Endpoint({ operationId: 'admin_permissions_list', summary: 'Catálogo de permisos implementados', permission: 'permissions.read', response: { schema: PermissionList } })
  permissions(@CurrentActor() actor: Actor) {
    return this.roles.catalog(actor);
  }

  @Get('permissions/matrix')
  @Endpoint({ operationId: 'admin_permissions_matrix', summary: 'Matriz de roles y permisos', permission: ['permissions.read', 'roles.read'], response: { schema: PermissionMatrix } })
  matrix(@CurrentActor() actor: Actor) {
    return this.roles.matrix(actor);
  }
}
