import { Body, Controller, Delete, Get, HttpCode, Inject, Patch, Post, Res, UploadedFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { ChatService } from '@starter/ai';
import type { Actor } from '@starter/auth';
import {
  AppError,
  AttachmentInfo,
  ChatAgentInfo,
  ChatRequest,
  ConversationList,
  ConversationMessages,
  IdParams,
  OkResponse,
  RenameConversationInput,
  TranscriptionResult,
  Uuid,
} from '@starter/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentActor } from '../../common/actor.decorator.js';
import { Endpoint, ZBody, ZParams, ZQuery } from '../../common/endpoint.js';
import { UploadFile, type UploadedBinary } from '../../common/upload.js';
import { CHAT } from './chat.token.js';

const AgentQuery = z.object({ agentId: Uuid.optional() });

@ApiTags('ai-chat')
@Controller('ai')
export class ChatController {
  constructor(@Inject(CHAT) private readonly chat: ChatService) {}

  @Get('chat/agent')
  @Endpoint({
    operationId: 'ai_chat_agent',
    summary: 'Agente del chat flotante (versión publicada)',
    description: 'Devuelve 409 NOT_CONFIGURED mientras no exista un agente publicado; el chat no se muestra en ese caso.',
    feature: 'ai',
    permission: 'ai.chat',
    query: AgentQuery,
    response: { schema: ChatAgentInfo },
    errors: [404, 409],
  })
  agent(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof AgentQuery>) {
    return this.chat.info(actor, q.agentId);
  }

  @Post('chat')
  @Endpoint({
    operationId: 'ai_chat_stream',
    summary: 'Enviar mensaje (streaming UI message stream del AI SDK)',
    description:
      'El cliente envía solo el texto nuevo y referencias a adjuntos ya subidos; historial, instrucciones, modelo, herramientas y colecciones los aporta el servidor. Responde Server-Sent Events con el protocolo UI message stream. Cerrar la conexión cancela la generación y el consumo se registra.',
    feature: 'ai',
    permission: 'ai.chat',
    body: ChatRequest,
    response: { contentType: 'text/event-stream', rawSchema: { type: 'string' }, description: 'UI message stream (SSE)' },
    errors: [402, 404, 409],
  })
  async stream(@CurrentActor() actor: Actor, @ZBody() body: z.infer<typeof ChatRequest>, @Res() res: Response) {
    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) ac.abort(new Error('El cliente cerró la conexión'));
    });
    await this.chat.stream(actor, body, res, ac.signal);
  }

  @Get('conversations')
  @Endpoint({ operationId: 'ai_conversations_list', summary: 'Mis conversaciones', feature: 'ai', permission: 'ai.chat', query: AgentQuery, response: { schema: ConversationList } })
  conversations(@CurrentActor() actor: Actor, @ZQuery() q: z.infer<typeof AgentQuery>) {
    return this.chat.conversations(actor, q.agentId);
  }

  @Get('conversations/:id')
  @Endpoint({ operationId: 'ai_conversations_get', summary: 'Mensajes de una conversación propia', feature: 'ai', permission: 'ai.chat', params: IdParams, response: { schema: ConversationMessages }, errors: [404] })
  conversation(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    return this.chat.conversation(actor, p.id);
  }

  @Patch('conversations/:id')
  @Endpoint({ operationId: 'ai_conversations_rename', summary: 'Renombrar conversación', feature: 'ai', permission: 'ai.chat', params: IdParams, body: RenameConversationInput, response: { schema: OkResponse }, errors: [404] })
  async rename(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @ZBody() body: z.infer<typeof RenameConversationInput>) {
    await this.chat.renameConversation(actor, p.id, body.title);
    return { ok: true as const };
  }

  @Delete('conversations/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'ai_conversations_delete', summary: 'Eliminar conversación y sus adjuntos', feature: 'ai', permission: 'ai.chat', params: IdParams, response: { schema: OkResponse }, errors: [404] })
  async remove(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.chat.deleteConversation(actor, p.id);
    return { ok: true as const };
  }

  @Post('attachments')
  @UploadFile('file', 'UPLOAD_MAX_BYTES')
  @Endpoint({
    operationId: 'ai_attachments_upload',
    summary: 'Subir archivo para el chat',
    description: 'Se valida por contenido (no por extensión ni MIME declarado). Imágenes, PDF y texto UTF-8.',
    feature: 'ai',
    permission: 'ai.chat',
    multipart: { fields: { file: { type: 'file', required: true } } },
    response: { status: 201, schema: AttachmentInfo },
    errors: [413],
  })
  upload(@CurrentActor() actor: Actor, @UploadedFile() file: UploadedBinary | undefined) {
    if (!file) throw AppError.validation('Falta el archivo (campo «file»)');
    return this.chat.upload(actor, file);
  }

  @Get('attachments/:id/content')
  @Endpoint({ operationId: 'ai_attachments_content', summary: 'Contenido de un adjunto propio', feature: 'ai', permission: 'ai.chat', params: IdParams, response: { contentType: 'application/octet-stream', rawSchema: { type: 'string', format: 'binary' } }, errors: [404] })
  async content(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>, @Res() res: Response) {
    const { row, body } = await this.chat.attachmentContent(actor, p.id);
    const inline = row.mediaType.startsWith('image/') || row.mediaType === 'application/pdf';
    res.setHeader('content-type', row.mediaType.startsWith('text/') ? `${row.mediaType}; charset=utf-8` : row.mediaType);
    res.setHeader('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; sandbox");
    res.setHeader('cache-control', 'private, max-age=3600');
    res.send(body);
  }

  @Delete('attachments/:id')
  @HttpCode(200)
  @Endpoint({ operationId: 'ai_attachments_delete', summary: 'Eliminar adjunto', feature: 'ai', permission: 'ai.chat', params: IdParams, response: { schema: OkResponse }, errors: [404] })
  async deleteAttachment(@CurrentActor() actor: Actor, @ZParams() p: z.infer<typeof IdParams>) {
    await this.chat.deleteAttachment(actor, p.id);
    return { ok: true as const };
  }

  @Post('transcriptions')
  @HttpCode(200)
  @UploadFile('audio', 'AUDIO_MAX_BYTES')
  @Endpoint({
    operationId: 'ai_transcriptions_create',
    summary: 'Transcribir una grabación del micrófono',
    description: 'Usa el modelo de transcripción del agente publicado. La grabación no se almacena; el texto vuelve al campo de entrada para revisión.',
    feature: 'ai',
    permission: 'ai.chat',
    multipart: { fields: { audio: { type: 'file', required: true }, agentId: { type: 'string', description: 'Agente (opcional: predeterminado)' } } },
    response: { schema: TranscriptionResult },
    errors: [402, 413, 502],
  })
  transcribe(@CurrentActor() actor: Actor, @UploadedFile() file: UploadedBinary | undefined, @Body('agentId') agentId?: string) {
    if (!file) throw AppError.validation('Falta la grabación (campo «audio»)');
    const parsed = agentId ? Uuid.safeParse(agentId) : null;
    if (parsed && !parsed.success) throw AppError.validation('agentId inválido');
    return this.chat.transcribe(actor, parsed?.data, file);
  }
}
