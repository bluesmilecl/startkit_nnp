import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import { AppError, isAppError, type ErrorResponse } from '@starter/contracts';
import { createLogger, currentContext, sanitizeError } from '@starter/observability';
import type { Response } from 'express';

const log = createLogger('api');

const HTTP_CODES: Record<number, ErrorResponse['error']['code']> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/** Maps every error to the documented ErrorResponse shape. Internal details never leak. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = currentContext()?.requestId;
    let status = 500;
    let body: ErrorResponse;
    if (isAppError(exception)) {
      const e = exception as AppError;
      status = e.status;
      body = { error: { code: e.code, message: e.message, details: e.details, requestId } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === 'string' ? response : ((response as { message?: string }).message ?? exception.message);
      body = { error: { code: HTTP_CODES[status] ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST'), message: String(message), requestId } };
    } else if (isBodyTooLarge(exception)) {
      status = 413;
      body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'El contenido supera el tamaño permitido', requestId } };
    } else {
      log.error({ err: sanitizeError(exception), stack: (exception as Error)?.stack }, 'unhandled error');
      body = { error: { code: 'INTERNAL', message: 'Error interno', requestId } };
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json(body);
  }
}

function isBodyTooLarge(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large';
}
