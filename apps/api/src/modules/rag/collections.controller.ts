import { Body, Controller, Delete, Get, HttpCode, Inject, Patch, Post, UploadedFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Actor } from '@starter/auth';
import {
  AppError,
  Collection,
  CollectionsPage,
  CollectionsQuery,
  CreateCollectionInput,
  CreateSourceInput,
  DocumentDetail,
  DocumentsPage,
  DocumentsQuery,
  IdParams,
  JobAccepted,
  OkResponse,
  ReindexInput,
  Source,
  SourceList,
  UpdateCollectionInput,
  UpdateSourceInput,
  Uuid,
} from '@starter/contracts';
import type { RagServices } from '@starter/rag';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams, ZQuery } from '../../common/endpoint.js';
import { UploadFile, type UploadedBinary } from '../../common/upload.js';
import { RAG } from './rag.token.js';

const DocParams = z.object({ id: Uuid, documentId: z.string().min(1).max(200) });

@ApiTags('rag-collections')
@Controller('rag')
export class RagCollectionsController {
  constructor(@Inject(RAG) private readonly rag: RagServices) {}

  @Get('collections')
  @Endpoint({ operationId: 'rag_collections_list', summary: 'Colecciones de conocimiento', feature: 'rag', query: CollectionsQuery, response: { schema: CollectionsPage } })
  list(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof CollectionsQuery>) {
    return this.rag.collections.list(actor, q);
  }

  @Post('collections')
  @Endpoint({ operationId: 'rag_collections_create', summary: 'Crear colección', feature: 'rag', permission: 'rag.collections.manage', body: CreateCollectionInput, response: { status: 201, schema: Collection }, errors: [409] })
  create(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof CreateCollectionInput>) {
    return this.rag.collections.create(actor, body);
  }

  @Get('collections/:id')
  @Endpoint({ operationId: 'rag_collections_get', summary: 'Colección con estadísticas', feature: 'rag', params: IdParams, response: { schema: Collection }, errors: [404] })
  get(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.collections.get(actor, p.id);
  }

  @Patch('collections/:id')
  @Endpoint({ operationId: 'rag_collections_update', summary: 'Editar colección (incluye permisos de acceso)', feature: 'rag', permission: 'rag.collections.manage', params: IdParams, body: UpdateCollectionInput, response: { schema: Collection }, errors: [404] })
  update(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateCollectionInput>) {
    return this.rag.collections.update(actor, p.id, body);
  }

  @Delete('collections/:id')
  @HttpCode(202)
  @Endpoint({ operationId: 'rag_collections_delete', summary: 'Eliminar colección (purga durable de documentos, vectores y archivos)', feature: 'rag', permission: 'rag.collections.manage', params: IdParams, response: { status: 202, schema: JobAccepted }, errors: [404, 409] })
  remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.collections.remove(actor, p.id);
  }

  @Post('collections/:id/reindex')
  @HttpCode(202)
  @Endpoint({
    operationId: 'rag_collections_reindex',
    summary: 'Reindexar (mismo perfil o cambio de modelo)',
    description: 'Construye una versión nueva del índice en segundo plano y cambia atómicamente al terminar; las búsquedas siguen usando la versión activa.',
    feature: 'rag',
    permission: 'rag.collections.manage',
    params: IdParams,
    body: ReindexInput,
    response: { status: 202, schema: JobAccepted },
    errors: [404, 409],
  })
  reindex(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof ReindexInput>) {
    return this.rag.collections.reindex(actor, p.id, body);
  }

  @Get('collections/:id/sources')
  @Endpoint({ operationId: 'rag_sources_list', summary: 'Fuentes de una colección', feature: 'rag', params: IdParams, response: { schema: SourceList }, errors: [404] })
  sources(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.sources.list(actor, p.id);
  }

  @Post('collections/:id/sources')
  @Endpoint({
    operationId: 'rag_sources_create',
    summary: 'Agregar fuente (URL, sitemap o texto)',
    description: 'Las URL se descargan con protección SSRF, límites de tamaño y tiempo. La sincronización se ejecuta como trabajo durable.',
    feature: 'rag',
    permission: 'rag.sources.manage',
    params: IdParams,
    body: CreateSourceInput,
    response: { status: 201, schema: Source },
    errors: [404],
  })
  createSource(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof CreateSourceInput>) {
    return this.rag.sources.create(actor, p.id, body);
  }

  @Patch('sources/:id')
  @Endpoint({ operationId: 'rag_sources_update', summary: 'Editar fuente (nombre, programación, pausa)', feature: 'rag', permission: 'rag.sources.manage', params: IdParams, body: UpdateSourceInput, response: { schema: Source }, errors: [404] })
  updateSource(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof UpdateSourceInput>) {
    return this.rag.sources.update(actor, p.id, body);
  }

  @Delete('sources/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'rag_sources_delete', summary: 'Eliminar fuente y sus documentos', feature: 'rag', permission: 'rag.sources.manage', params: IdParams, response: { schema: OkResponse }, errors: [404] })
  async removeSource(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.rag.sources.remove(actor, p.id);
    return { ok: true as const };
  }

  @Post('sources/:id/sync')
  @HttpCode(202)
  @Endpoint({ operationId: 'rag_sources_sync', summary: 'Sincronizar fuente ahora', feature: 'rag', permission: 'rag.sources.manage', params: IdParams, response: { status: 202, schema: JobAccepted }, errors: [404] })
  sync(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.rag.sources.sync(actor, p.id);
  }

  @Post('collections/:id/documents')
  @HttpCode(202)
  @UploadFile('file', 'UPLOAD_MAX_BYTES')
  @Endpoint({
    operationId: 'rag_documents_upload',
    summary: 'Subir documento (PDF, Markdown, HTML o texto)',
    description: 'Validado por contenido, almacenado y luego indexado por un trabajo durable. aclRoles/aclUsers (separados por coma) restringen el documento.',
    feature: 'rag',
    permission: 'rag.sources.manage',
    params: IdParams,
    multipart: { fields: { file: { type: 'file', required: true }, aclRoles: { type: 'string' }, aclUsers: { type: 'string' } } },
    response: { status: 202, schema: JobAccepted },
    errors: [404, 413],
  })
  upload(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @UploadedFile() file: UploadedBinary | undefined, @Body() body: { aclRoles?: string; aclUsers?: string }) {
    if (!file) throw AppError.validation('Falta el archivo (campo «file»)');
    const split = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const users = split(body?.aclUsers);
    if (users.some((u) => !Uuid.safeParse(u).success)) throw AppError.validation('aclUsers debe contener ids de usuario');
    return this.rag.sources.upload(actor, p.id, file, { roles: split(body?.aclRoles), users });
  }

  @Get('documents')
  @Endpoint({ operationId: 'rag_documents_list', summary: 'Documentos de las colecciones autorizadas', feature: 'rag', permission: 'rag.documents.read', query: DocumentsQuery, response: { schema: DocumentsPage } })
  documents(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof DocumentsQuery>) {
    return this.rag.documents.list(actor, q);
  }

  @Get('collections/:id/documents/:documentId')
  @Endpoint({ operationId: 'rag_documents_get', summary: 'Documento con sus fragmentos', feature: 'rag', permission: 'rag.documents.read', params: DocParams, response: { schema: DocumentDetail }, errors: [404] })
  document(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof DocParams>) {
    return this.rag.documents.get(actor, p.id, p.documentId);
  }

  @Delete('collections/:id/documents/:documentId')
  @HttpCode(202)
  @Endpoint({ operationId: 'rag_documents_delete', summary: 'Eliminar documento (vectores y archivo, trabajo durable)', feature: 'rag', permission: 'rag.documents.delete', params: DocParams, response: { status: 202, schema: JobAccepted }, errors: [404] })
  deleteDocument(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof DocParams>) {
    return this.rag.documents.remove(actor, p.id, p.documentId);
  }

  @Post('collections/:id/documents/:documentId/reprocess')
  @HttpCode(202)
  @Endpoint({ operationId: 'rag_documents_reprocess', summary: 'Volver a procesar un documento', feature: 'rag', permission: 'rag.sources.manage', params: DocParams, response: { status: 202, schema: JobAccepted }, errors: [404] })
  reprocess(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof DocParams>) {
    return this.rag.documents.reprocess(actor, p.id, p.documentId);
  }
}
