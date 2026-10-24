import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import { AppError, codeForStatus, ERROR_CATALOG, isAppError, retryAfterOf, type ErrorLogLevel, type ErrorResponse } from '@starter/contracts';
import { mapDatabaseError, pgErrorOf } from '@starter/db';
import { createLogger, currentContext, metrics, sanitizeError } from '@starter/observability';
import type { Request, Response } from 'express';

const log = createLogger('api');
const errorsTotal = metrics.counter('http_errors_total');

/** Where a failure came from; decides the log level and which fields are logged. */
export type ErrorOrigin = 'app' | 'framework' | 'body' | 'database' | 'unknown';

export interface ClassifiedError {
  error: AppError;
  origin: ErrorOrigin;
  log: ErrorLogLevel;
}

/**
 * Turns anything thrown while serving a request into a catalog error. Pure, so the filter, the
 * CLI and the unit tests agree on the mapping:
 * - AppError: as thrown (its message was written for the person).
 * - Nest HttpException (unknown route, multer limits…): catalog message; framework text is English
 *   and can describe internals.
 * - body-parser errors (malformed JSON, too large, bad charset): 4xx instead of a 500.
 * - PostgreSQL errors (unique race, deadlock, connection lost): see `mapDatabaseError`.
 * - Anything else: INTERNAL with a generic message; the cause goes to the log only.
 */
export function classifyError(exception: unknown): ClassifiedError {
  if (isAppError(exception)) return { error: exception, origin: 'app', log: ERROR_CATALOG[exception.code]?.log ?? 'error' };
  const body = bodyParserError(exception);
  if (body) return { error: body, origin: 'body', log: 'info' };
  if (exception instanceof HttpException) {
    const code = codeForStatus(exception.getStatus());
    return { error: new AppError(code, ERROR_CATALOG[code].message, undefined, { cause: exception }), origin: 'framework', log: ERROR_CATALOG[code].log };
  }
  const db = mapDatabaseError(exception);
  // Mapped database errors mean a race or a rule the contract did not catch: worth a warning.
  if (db) return { error: db, origin: 'database', log: db.status >= 500 ? 'error' : 'warn' };
  return { error: new AppError('INTERNAL', ERROR_CATALOG.INTERNAL.message, undefined, { cause: exception }), origin: 'unknown', log: 'error' };
}

/** Serialized body. Details are sent only for domain and database errors (never framework internals). */
export function errorBody(c: ClassifiedError, requestId: string | undefined): ErrorResponse {
  const details = c.origin === 'app' || c.origin === 'database' ? c.error.details : undefined;
  return { error: { code: c.error.code, message: c.error.message, ...(details === undefined ? {} : { details }), requestId } };
}

/** Maps every error to the documented ErrorResponse shape, logs it once and counts it. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = currentContext()?.requestId ?? (res.getHeader('x-request-id') as string | undefined);
    const c = classifyError(exception);
    const { status, code } = c.error;

    const cause = c.origin === 'app' ? c.error.cause : exception;
    const pg = c.origin === 'database' ? pgErrorOf(exception) : null;
    log[c.log](
      {
        errorCode: code,
        status,
        origin: c.origin,
        method: req?.method,
        path: req?.originalUrl?.split('?')[0],
        ...(cause === undefined ? {} : { cause: sanitizeError(cause) }),
        ...(pg ? { db: { sqlState: pg.code, constraint: pg.constraint, table: pg.table } } : {}),
        // Stacks only for failures that need a developer; expected 4xx outcomes stay one line.
        ...(c.log === 'error' && cause instanceof Error ? { stack: cause.stack } : {}),
      },
      status >= 500 ? 'request failed' : 'request rejected',
    );
    errorsTotal.inc({ code, status: String(status) });

    if (res.headersSent) {
      // A stream (SSE, download) already started: the status line is gone, so just close it.
      res.end();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    const retryAfter = retryAfterOf(c.error);
    if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
    res.status(status).json(errorBody(c, requestId));
  }
}

function bodyParserError(err: unknown): AppError | null {
  const e = err as { type?: unknown; status?: unknown } | null;
  if (typeof e !== 'object' || e === null || typeof e.type !== 'string' || typeof e.status !== 'number') return null;
  switch (e.type) {
    case 'entity.too.large':
      return AppError.tooLarge();
    case 'entity.parse.failed':
      return AppError.badRequest('El cuerpo de la solicitud no es JSON válido.');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new AppError('UNSUPPORTED_MEDIA_TYPE', ERROR_CATALOG.UNSUPPORTED_MEDIA_TYPE.message);
    case 'request.aborted':
      return AppError.badRequest('La solicitud se interrumpió antes de completarse.');
    default: {
      if (e.status < 400 || e.status >= 500) return null;
      const code = codeForStatus(e.status);
      return new AppError(code, ERROR_CATALOG[code].message);
    }
  }
}
