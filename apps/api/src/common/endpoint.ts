import { applyDecorators, createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AppError, type PermissionKey } from '@starter/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { inlineSchema, refOrInline } from './openapi-zod.js';

export const ENDPOINT_METADATA = 'starter:endpoint';

export interface EndpointResponse {
  status?: number;
  schema?: z.ZodType;
  description?: string;
  /** Non-JSON responses (streams, downloads). */
  contentType?: string;
  /** Free-form OpenAPI schema for non-JSON responses. */
  rawSchema?: Record<string, unknown>;
}

export interface EndpointOptions {
  operationId: string;
  summary: string;
  description?: string;
  body?: z.ZodType;
  /** multipart/form-data upload description (validated by the handler). */
  multipart?: { fields: Record<string, { type: 'string' | 'file'; description?: string; required?: boolean }> };
  query?: z.ZodObject;
  params?: z.ZodObject;
  response: EndpointResponse;
  extraResponses?: EndpointResponse[];
  /** HTTP statuses documented with the ErrorResponse schema. */
  errors?: number[];
  /** Permission(s) checked by the global guard before the handler runs (all required). */
  permission?: PermissionKey | PermissionKey[];
  /** No session required. */
  public?: boolean;
  /** Feature module that must be enabled. */
  feature?: 'ai' | 'rag' | 'organizations';
}

const DEFAULT_ERRORS = [400, 401, 403, 422, 500];

/**
 * Single source of truth for an operation: runtime validation (Zod), authorization metadata and
 * the OpenAPI description are all derived from these options. The contract test rejects routes
 * without it.
 */
export function Endpoint(options: EndpointOptions): MethodDecorator {
  const decorators: (MethodDecorator | ClassDecorator)[] = [
    SetMetadata(ENDPOINT_METADATA, options),
    ApiOperation({ operationId: options.operationId, summary: options.summary, description: describe(options) }),
  ];
  if (!options.public) decorators.push(ApiCookieAuth('session'));
  if (options.body) decorators.push(ApiBody({ required: true, schema: refOrInline(options.body, 'input') as never }));
  if (options.multipart) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [name, f] of Object.entries(options.multipart.fields)) {
      properties[name] = f.type === 'file' ? { type: 'string', format: 'binary', description: f.description } : { type: 'string', description: f.description };
      if (f.required) required.push(name);
    }
    decorators.push(ApiConsumes('multipart/form-data'), ApiBody({ schema: { type: 'object', properties, required } as never }));
  }
  for (const [name, schema] of Object.entries(options.params?.shape ?? {})) {
    decorators.push(ApiParam({ name, required: true, schema: inlineSchema(schema as z.ZodType, 'input') as never }));
  }
  for (const [name, schema] of Object.entries(options.query?.shape ?? {})) {
    const s = schema as z.ZodType;
    const optional = s.safeParse(undefined).success;
    decorators.push(
      ApiQuery({ name, required: !optional, schema: inlineSchema(s, 'input') as never, description: s.description }),
    );
  }
  for (const r of [options.response, ...(options.extraResponses ?? [])]) {
    const status = r.status ?? 200;
    if (r.contentType && r.contentType !== 'application/json') {
      decorators.push(ApiProduces(r.contentType));
      decorators.push(
        ApiResponse({
          status,
          description: r.description ?? 'OK',
          content: { [r.contentType]: { schema: (r.rawSchema ?? { type: 'string', format: 'binary' }) as never } },
        }),
      );
    } else if (r.schema) {
      decorators.push(ApiResponse({ status, description: r.description ?? 'OK', schema: refOrInline(r.schema, 'output') as never }));
    } else {
      decorators.push(ApiResponse({ status, description: r.description ?? 'No content' }));
    }
  }
  const errors = new Set([
    ...(options.public ? DEFAULT_ERRORS.filter((s) => s !== 401 && s !== 403) : DEFAULT_ERRORS),
    ...(options.params ? [404] : []),
    ...(options.errors ?? []),
  ]);
  for (const status of errors) {
    decorators.push(ApiResponse({ status, description: errorDescription(status), schema: { $ref: '#/components/schemas/ErrorResponse' } as never }));
  }
  return applyDecorators(...decorators) as MethodDecorator;
}

function describe(o: EndpointOptions): string {
  const parts = [o.description ?? ''];
  if (o.public) parts.push('**Acceso:** público.');
  else if (o.permission) parts.push(`**Permiso requerido:** ${[o.permission].flat().map((p) => `\`${p}\``).join(', ')}.`);
  else parts.push('**Acceso:** cualquier sesión válida.');
  if (o.feature) parts.push(`**Módulo:** \`${o.feature}\` debe estar habilitado.`);
  return parts.filter(Boolean).join('\n\n');
}

function errorDescription(status: number): string {
  const map: Record<number, string> = {
    400: 'Solicitud inválida',
    401: 'Sesión requerida',
    402: 'Presupuesto excedido',
    403: 'Permiso insuficiente',
    404: 'No encontrado',
    409: 'Conflicto',
    410: 'Expirado',
    412: 'Precondición fallida (versión desactualizada)',
    413: 'Contenido demasiado grande',
    415: 'Tipo de contenido no soportado',
    422: 'Validación fallida',
    429: 'Demasiadas solicitudes',
    500: 'Error interno',
    502: 'Error del proveedor externo',
    503: 'Servicio no disponible temporalmente (ver Retry-After)',
    504: 'Tiempo agotado',
  };
  return map[status] ?? 'Error';
}

export function getEndpointOptions(ctx: ExecutionContext): EndpointOptions | undefined {
  return Reflect.getMetadata(ENDPOINT_METADATA, ctx.getHandler()) as EndpointOptions | undefined;
}

const INVALID_MESSAGE = { body: 'Algunos datos no son válidos; revisa los campos marcados', query: 'Los parámetros de la consulta no son válidos' } as const;

function parseWith(schema: z.ZodType | undefined, value: unknown, where: 'body' | 'query' | 'params'): unknown {
  if (!schema) return value;
  const result = schema.safeParse(value);
  if (!result.success) {
    // Path params identify a resource: a malformed one cannot exist, so it reads as "not found".
    if (where === 'params') throw new AppError('NOT_FOUND', 'No existe un recurso con ese identificador');
    throw AppError.validation(
      INVALID_MESSAGE[where],
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    );
  }
  return result.data;
}

/** Validated request body according to the endpoint's `body` schema. */
export const ZBody = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return parseWith(getEndpointOptions(ctx)?.body, req.body ?? {}, 'body');
});

/** Validated query string according to the endpoint's `query` schema. */
export const ZQuery = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return parseWith(getEndpointOptions(ctx)?.query, { ...req.query }, 'query');
});

/** Validated path params according to the endpoint's `params` schema. */
export const ZParams = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return parseWith(getEndpointOptions(ctx)?.params, { ...req.params }, 'params');
});
