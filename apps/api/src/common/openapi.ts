import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { zodComponentSchemas } from './openapi-zod.js';

export interface OpenApiExtras {
  /** Additional path items (e.g. Better Auth handler routes mounted outside controllers). */
  paths?: OpenAPIObject['paths'];
  tags?: { name: string; description?: string }[];
}

export function buildOpenApiDocument(app: INestApplication, version: string, extras: OpenApiExtras = {}): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Starter Kit API')
    .setDescription(
      [
        'API de negocio y autenticación del starter (NestJS). Todas las rutas se publican bajo el mismo origen que la web (`/api`).',
        'La autenticación usa cookies de sesión HttpOnly emitidas por Better Auth (`/api/auth/*`).',
        'Los errores siguen el esquema `ErrorResponse`.',
      ].join('\n\n'),
    )
    .setVersion(version)
    .addCookieAuth('better-auth.session_token', { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' }, 'session')
    .addServer('/')
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
  document.components ??= {};
  document.components.schemas = { ...(document.components.schemas ?? {}), ...zodComponentSchemas() } as never;
  if (extras.paths) document.paths = { ...extras.paths, ...document.paths };
  if (extras.tags) document.tags = [...(document.tags ?? []), ...extras.tags];
  document.paths = Object.fromEntries(Object.entries(document.paths).sort(([a], [b]) => a.localeCompare(b)));
  return document;
}
