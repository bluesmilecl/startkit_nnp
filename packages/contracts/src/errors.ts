import type { ErrorCode } from './common.js';

export type ErrorLogLevel = 'info' | 'warn' | 'error';

export interface ErrorCatalogEntry {
  /** HTTP status sent by the API. */
  status: number;
  /** Short Spanish heading for toasts, alerts and the error page. */
  title: string;
  /** Default Spanish message when the thrower has nothing more specific (framework errors, unknown codes). */
  message: string;
  /** The same request may succeed later without changes: the web offers "Reintentar" and jobs retry. */
  retryable: boolean;
  /** Level the API and the worker log it at: 4xx are expected outcomes, 5xx need attention. */
  log: ErrorLogLevel;
}

/**
 * Single error catalog shared by the API, the worker, the CLI and the web. Add a code here (and to
 * `ErrorCodes`) instead of inventing ad-hoc statuses; docs/errors.md explains when to use each one.
 */
export const ERROR_CATALOG: Record<ErrorCode, ErrorCatalogEntry> = {
  BAD_REQUEST: { status: 400, title: 'Solicitud inválida', message: 'La solicitud no tiene un formato válido.', retryable: false, log: 'info' },
  VALIDATION_FAILED: { status: 422, title: 'Revisa los datos', message: 'Algunos datos no son válidos; revisa los campos marcados.', retryable: false, log: 'info' },
  UNAUTHENTICATED: { status: 401, title: 'Sesión requerida', message: 'Tu sesión no es válida o venció; vuelve a ingresar.', retryable: false, log: 'info' },
  FORBIDDEN: { status: 403, title: 'Sin permiso', message: 'No tienes permiso para realizar esta acción.', retryable: false, log: 'info' },
  NOT_FOUND: { status: 404, title: 'No encontrado', message: 'Lo que buscas no existe o ya no está disponible.', retryable: false, log: 'info' },
  CONFLICT: { status: 409, title: 'Conflicto', message: 'La operación choca con datos existentes.', retryable: false, log: 'info' },
  PRECONDITION_FAILED: { status: 412, title: 'Datos desactualizados', message: 'Alguien más modificó este registro; recarga para ver los cambios.', retryable: false, log: 'info' },
  GONE: { status: 410, title: 'Ya no está disponible', message: 'Este recurso venció o fue retirado.', retryable: false, log: 'info' },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Contenido demasiado grande', message: 'El contenido supera el tamaño permitido.', retryable: false, log: 'info' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Formato no soportado', message: 'El formato del contenido no está soportado.', retryable: false, log: 'info' },
  RATE_LIMITED: { status: 429, title: 'Demasiadas solicitudes', message: 'Hiciste demasiadas solicitudes seguidas; espera un momento e intenta de nuevo.', retryable: true, log: 'warn' },
  BUDGET_EXCEEDED: { status: 402, title: 'Presupuesto agotado', message: 'Se alcanzó el límite de presupuesto configurado.', retryable: false, log: 'info' },
  FEATURE_DISABLED: { status: 404, title: 'Función desactivada', message: 'Esta función está desactivada en esta instalación.', retryable: false, log: 'info' },
  NOT_CONFIGURED: { status: 409, title: 'Falta configuración', message: 'Falta configurar algo antes de usar esta función.', retryable: false, log: 'info' },
  CAPABILITY_UNSUPPORTED: { status: 422, title: 'No soportado', message: 'El proveedor o la conexión no soporta esta operación.', retryable: false, log: 'info' },
  UPSTREAM_ERROR: { status: 502, title: 'Falló un servicio externo', message: 'Un servicio externo no respondió correctamente.', retryable: true, log: 'warn' },
  UNAVAILABLE: { status: 503, title: 'Servicio no disponible', message: 'El servicio no está disponible en este momento; intenta de nuevo en unos segundos.', retryable: true, log: 'warn' },
  TIMEOUT: { status: 504, title: 'Tiempo agotado', message: 'La operación tardó demasiado y se canceló.', retryable: true, log: 'warn' },
  // Unknown cause: may be transient, so retrying is allowed (jobs are bounded by their retry limit).
  INTERNAL: {
    status: 500,
    title: 'Error inesperado',
    message: 'Ocurrió un error inesperado. Si persiste, comparte el código de solicitud con soporte.',
    retryable: true,
    log: 'error',
  },
};

export const ERROR_STATUS = Object.fromEntries(Object.entries(ERROR_CATALOG).map(([code, e]) => [code, e.status])) as Record<ErrorCode, number>;

/** Catalog entry for any code string (unknown codes, e.g. from an older client, read as INTERNAL). */
export function errorInfo(code: string | undefined): ErrorCatalogEntry & { code: ErrorCode } {
  const known = code !== undefined && Object.hasOwn(ERROR_CATALOG, code);
  const c = (known ? code : 'INTERNAL') as ErrorCode;
  return { code: c, ...ERROR_CATALOG[c] };
}

/** Code for an HTTP status (framework exceptions, upstream responses). */
export function codeForStatus(status: number): ErrorCode {
  const preferred: Partial<Record<number, ErrorCode>> = { 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'VALIDATION_FAILED' };
  if (preferred[status]) return preferred[status];
  const match = (Object.keys(ERROR_CATALOG) as ErrorCode[]).find((c) => ERROR_CATALOG[c].status === status);
  return match ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST');
}

/** One invalid field; the web maps `path` (dot-joined) onto the form field with that name. */
export interface FieldIssue {
  path: string;
  message: string;
  code?: string;
}

export interface AppErrorOptions {
  /** Original error, kept for logs only (never serialized to the client). */
  cause?: unknown;
  /** Overrides the catalog default, e.g. an upstream 4xx that will never succeed on retry. */
  retryable?: boolean;
}

/**
 * Domain error thrown by application services (REST, CLI, worker and chat tools share them).
 * Messages are safe to show to the actor in Spanish; never include secrets, SQL, stack traces or
 * raw upstream bodies. `details` follows the per-code conventions in docs/errors.md.
 */
export class AppError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    options: AppErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.status = ERROR_CATALOG[code].status;
    this.retryable = options.retryable ?? ERROR_CATALOG[code].retryable;
  }

  /** `AppError.notFound('Proyecto')` → "Proyecto no encontrado"; pass 'f' for "Colección no encontrada". */
  static notFound(what: string, gender: 'm' | 'f' = 'm'): AppError {
    return new AppError('NOT_FOUND', `${what} no ${gender === 'f' ? 'encontrada' : 'encontrado'}`);
  }
  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('BAD_REQUEST', message, details);
  }
  static unauthenticated(message = ERROR_CATALOG.UNAUTHENTICATED.message): AppError {
    return new AppError('UNAUTHENTICATED', message);
  }
  static forbidden(message = 'No tienes permiso para realizar esta acción', details?: unknown): AppError {
    return new AppError('FORBIDDEN', message, details);
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', message, details);
  }
  /** Validation error; with `issues` the web marks each field. */
  static validation(message: string, details?: FieldIssue[] | unknown): AppError {
    return new AppError('VALIDATION_FAILED', message, details);
  }
  /** Shortcut for a single invalid field (e.g. a uniqueness rule checked in the service). */
  static field(path: string, message: string, code: AppError['code'] = 'VALIDATION_FAILED'): AppError {
    return new AppError(code, message, [{ path, message }] satisfies FieldIssue[]);
  }
  static precondition(message: string, details?: unknown): AppError {
    return new AppError('PRECONDITION_FAILED', message, details);
  }
  static notConfigured(message: string, details?: unknown): AppError {
    return new AppError('NOT_CONFIGURED', message, details);
  }
  static unsupported(message: string, details?: unknown): AppError {
    return new AppError('CAPABILITY_UNSUPPORTED', message, details);
  }
  static tooLarge(message = ERROR_CATALOG.PAYLOAD_TOO_LARGE.message, details?: unknown): AppError {
    return new AppError('PAYLOAD_TOO_LARGE', message, details);
  }
  static rateLimited(message = ERROR_CATALOG.RATE_LIMITED.message, retryAfterSeconds?: number): AppError {
    return new AppError('RATE_LIMITED', message, retryAfterSeconds ? { retryAfterSeconds } : undefined);
  }
  /** An external service (AI provider, external API, mail, URL) failed. Keep the raw cause for logs only. */
  static upstream(message: string, options: AppErrorOptions & { details?: unknown } = {}): AppError {
    return new AppError('UPSTREAM_ERROR', message, options.details, options);
  }
  static unavailable(message = ERROR_CATALOG.UNAVAILABLE.message, retryAfterSeconds?: number, cause?: unknown): AppError {
    return new AppError('UNAVAILABLE', message, retryAfterSeconds ? { retryAfterSeconds } : undefined, { cause });
  }
  static timeout(message = ERROR_CATALOG.TIMEOUT.message, cause?: unknown): AppError {
    return new AppError('TIMEOUT', message, undefined, { cause });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AppError');
}

/**
 * Whether an operation that failed with `err` may succeed if repeated unchanged. Domain errors
 * follow the catalog (or their explicit override); anything else (network, driver, bugs) is
 * unknown and treated as retryable so durable jobs get their bounded retries.
 */
export function isRetryableError(err: unknown): boolean {
  if (!isAppError(err)) return true;
  const e = err as Partial<AppError>;
  return typeof e.retryable === 'boolean' ? e.retryable : errorInfo(e.code).retryable;
}

/** Seconds the client should wait before retrying (RATE_LIMITED, UNAVAILABLE), if the thrower said. */
export function retryAfterOf(err: unknown): number | undefined {
  const d = isAppError(err) ? (err.details as { retryAfterSeconds?: unknown } | undefined) : undefined;
  const v = d?.retryAfterSeconds;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.ceil(v) : undefined;
}
