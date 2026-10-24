import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Actor } from '@starter/auth';
import { CreateProjectInput, IdParams, OkResponse, Project, ProjectsPage, ProjectsQuery, UpdateProjectInput } from '@starter/contracts';
import type { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams, ZQuery } from '../../common/endpoint.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @Endpoint({ operationId: 'projects_list', summary: 'Listar proyectos', description: 'Búsqueda por nombre o descripción, filtro por estado, orden y paginación en el servidor.', permission: 'projects.read', query: ProjectsQuery, response: { schema: ProjectsPage } })
  list(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof ProjectsQuery>) {
    return this.projects.list(actor, q);
  }

  @Get(':id')
  @Endpoint({ operationId: 'projects_get', summary: 'Proyecto', permission: 'projects.read', params: IdParams, response: { schema: Project }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.projects.get(actor, p.id);
  }

  @Post()
  @Endpoint({ operationId: 'projects_create', summary: 'Crear proyecto', permission: 'projects.manage', body: CreateProjectInput, response: { status: 201, schema: Project }, errors: [409] })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateProjectInput>) {
    return this.projects.create(actor, body);
  }

  @Patch(':id')
  @Endpoint({
    operationId: 'projects_update',
    summary: 'Editar, archivar o restaurar un proyecto',
    description: 'Requiere la versión leída; si otra persona lo modificó entre tanto responde 412 y no aplica cambios.',
    permission: 'projects.manage',
    params: IdParams,
    body: UpdateProjectInput,
    response: { schema: Project },
    errors: [404, 409, 412],
  })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateProjectInput>) {
    return this.projects.update(actor, p.id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @Endpoint({ operationId: 'projects_delete', summary: 'Eliminar proyecto', permission: 'projects.manage', params: IdParams, response: { schema: OkResponse }, errors: [404] })
  async remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.projects.remove(actor, p.id);
    return { ok: true as const };
  }
}
