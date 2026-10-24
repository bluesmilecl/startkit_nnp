import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditQueryService, type Actor } from '@starter/auth';
import { AuditPage, AuditQuery } from '@starter/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZQuery } from '../../common/endpoint.js';
import { toCsv } from '../../common/csv.js';

@ApiTags('admin-audit')
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @Endpoint({ operationId: 'admin_audit_list', summary: 'Eventos de auditoría', permission: 'audit.read', query: AuditQuery, response: { schema: AuditPage } })
  list(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof AuditQuery>) {
    return this.audit.list(actor, q);
  }

  @Get('export.csv')
  @Endpoint({
    operationId: 'admin_audit_export',
    summary: 'Exportar auditoría a CSV (máx. 5.000 filas)',
    permission: 'audit.read',
    query: AuditQuery,
    response: { contentType: 'text/csv', rawSchema: { type: 'string' } },
  })
  async export(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof AuditQuery>, @Res() res: Response) {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= 50; page++) {
      const result = await this.audit.list(actor, { ...q, page, pageSize: 100 });
      rows.push(...result.items.map((e) => ({ ...e, before: JSON.stringify(e.before), after: JSON.stringify(e.after), metadata: JSON.stringify(e.metadata) })));
      if (page >= result.pageCount) break;
    }
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="audit.csv"');
    res.send(toCsv(rows, ['occurredAt', 'actorType', 'actorEmail', 'action', 'resourceType', 'resourceId', 'outcome', 'requestId', 'before', 'after', 'metadata']));
  }
}
