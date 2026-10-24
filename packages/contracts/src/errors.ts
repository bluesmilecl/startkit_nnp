import type { ErrorCode } from './common.js';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  BUDGET_EXCEEDED: 402,
  FEATURE_DISABLED: 404,
  NOT_CONFIGURED: 409,
  CAPABILITY_UNSUPPORTED: 422,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

/**
 * Domain error thrown by application services (REST, CLI, worker and chat tools share them).
 * Messages are safe to show to the actor; never include secrets.
 */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_STATUS[code];
  }

  static notFound(what: string): AppError {
    return new AppError('NOT_FOUND', `${what} no encontrado`);
  }
  static forbidden(message = 'No tienes permiso para realizar esta acción', details?: unknown): AppError {
    return new AppError('FORBIDDEN', message, details);
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', message, details);
  }
  static validation(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_FAILED', message, details);
  }
  static precondition(message: string, details?: unknown): AppError {
    return new AppError('PRECONDITION_FAILED', message, details);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AppError');
}
