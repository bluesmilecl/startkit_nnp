import { codeForStatus, ERROR_CATALOG, errorInfo, type ErrorCode } from '@starter/contracts';

/**
 * Codes produced only in the browser: no response arrived (NETWORK), the request was cancelled
 * (ABORTED) or the failure came from the page's own code (CLIENT). Everything else is a server
 * code from the shared catalog (@starter/contracts ERROR_CATALOG).
 */
export type ClientErrorCode = 'NETWORK' | 'ABORTED' | 'CLIENT';

/** Everything a view needs to show an error, whatever threw it. */
export interface Problem {
  code: ErrorCode | ClientErrorCode | (string & {});
  /** HTTP status (0 when no response arrived). */
  status: number;
  /** Short heading: "Sin permiso", "No encontrado"… */
  title: string;
  /** Spanish sentence safe to show (server message or catalog default). */
  message: string;
  /** Correlation id to quote to support (same as the x-request-id header and the API logs). */
  requestId?: string;
  details?: unknown;
  /** VALIDATION_FAILED/CONFLICT details by field path (first message per field). */
  fieldErrors: Record<string, string>;
  /** Repeating the same request may work: show "Reintentar". */
  retryable: boolean;
  retryAfterSeconds?: number;
}

/** Body of every API error response (`ErrorResponse` in the contract). */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

const CLIENT_PROBLEMS: Record<ClientErrorCode, Pick<Problem, 'title' | 'message' | 'retryable'>> = {
  NETWORK: { title: 'Sin conexión', message: 'No pudimos conectar con el servidor; revisa tu conexión e intenta de nuevo.', retryable: true },
  ABORTED: { title: 'Solicitud cancelada', message: 'La solicitud se canceló antes de terminar.', retryable: true },
  CLIENT: { title: 'Error inesperado', message: 'Algo falló en esta pantalla. Recarga la página; si persiste, avisa a soporte.', retryable: true },
};

/**
 * Error thrown by the generated API client (installed as its error interceptor). It keeps the API
 * body in `error` (as before) and mirrors it in `data`/`statusCode` so the problem survives
 * Nuxt's SSR payload, which serializes errors as { message, statusCode, data }.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly statusCode: number;
  readonly data: ApiErrorBody;
  constructor(
    readonly status: number,
    readonly error: ApiErrorBody['error'],
  ) {
    super(error.message);
    this.statusCode = status;
    this.data = { error };
  }
}

export function isApiError(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ApiError' && typeof (err as ApiError).error?.code === 'string';
}

/**
 * Converts what the generated client caught (parsed JSON body, raw text, fetch failure) into an
 * ApiError. Non-JSON error pages from a proxy (502 HTML) become the catalog message for their
 * status, so markup never reaches a toast.
 */
export function toApiError(caught: unknown, response?: Response): unknown {
  if (isApiError(caught)) return caught;
  const requestId = response?.headers.get('x-request-id') ?? undefined;
  if (!response) {
    const name = (caught as { name?: string })?.name;
    // Only fetch's own failures are network problems; errors from interceptors or bugs propagate as they are.
    if (name !== 'TypeError' && name !== 'AbortError' && name !== 'TimeoutError') return caught;
    const code: ClientErrorCode = name === 'AbortError' ? 'ABORTED' : 'NETWORK';
    return new ApiError(0, { code, message: CLIENT_PROBLEMS[code].message });
  }
  const body = (caught as Partial<ApiErrorBody> | undefined)?.error;
  if (body && typeof body.code === 'string' && typeof body.message === 'string') return new ApiError(response.status, { ...body, requestId: body.requestId ?? requestId });
  const code = codeForStatus(response.status);
  return new ApiError(response.status, { code, message: ERROR_CATALOG[code].message, requestId });
}

interface ErrorLike {
  name?: string;
  message?: string;
  status?: number;
  statusCode?: number;
  code?: unknown;
  error?: Partial<ApiErrorBody['error']>;
  data?: { error?: Partial<ApiErrorBody['error']> } | null;
  cause?: unknown;
}

/** The API body inside an ApiError, a NuxtError (cause/data after SSR), a $fetch error or a raw body. */
function bodyOf(e: ErrorLike, depth = 0): Partial<ApiErrorBody['error']> | undefined {
  // An AppError thrown by the page itself (`throw AppError.validation('…')`) carries a safe message.
  if (e.name === 'AppError' && typeof e.code === 'string') return { code: e.code, message: e.message, details: (e as { details?: unknown }).details };
  // Nuxt's serialized error has `error: true` next to `data`, so each candidate is checked.
  for (const body of [e.error, e.data?.error]) if (body && typeof body === 'object' && typeof body.code === 'string') return body;
  if (depth < 3 && e.cause && typeof e.cause === 'object') return bodyOf(e.cause as ErrorLike, depth + 1);
  return undefined;
}

function fieldErrorsOf(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const d of details as { path?: unknown; message?: unknown }[]) {
    if (typeof d?.path === 'string' && typeof d.message === 'string' && !(d.path in out)) out[d.path] = d.message;
  }
  return out;
}

function retryAfterOf(details: unknown): number | undefined {
  const v = (details as { retryAfterSeconds?: unknown } | null | undefined)?.retryAfterSeconds;
  return typeof v === 'number' && v > 0 ? v : undefined;
}

/**
 * Single error normalizer for the web: API errors (client, $fetch, NuxtError after SSR), network
 * failures, cancellations and plain exceptions all become a `Problem` with a Spanish message.
 * Raw JavaScript messages ("Cannot read properties of undefined") and English framework text are
 * never shown; `fallback` replaces them.
 */
export function normalizeError(err: unknown, fallback?: string): Problem {
  if (typeof err === 'string') return problemFor('CLIENT', 0, { message: err && !err.includes('<') ? err : fallback });
  const e = (err ?? {}) as ErrorLike;
  const body = bodyOf(e);
  if (body?.code) {
    const info = errorInfo(body.code);
    const status = e.status ?? e.statusCode ?? info.status;
    const isClientCode = body.code in CLIENT_PROBLEMS;
    const base = isClientCode ? problemFor(body.code as ClientErrorCode, status, {}) : null;
    return {
      code: body.code,
      status,
      title: base?.title ?? (Object.hasOwn(ERROR_CATALOG, body.code) ? info.title : codeTitleFallback(status)),
      message: body.message || base?.message || info.message,
      requestId: body.requestId,
      details: body.details,
      fieldErrors: fieldErrorsOf(body.details),
      retryable: base?.retryable ?? info.retryable,
      retryAfterSeconds: retryAfterOf(body.details),
    };
  }
  if (e.name === 'AbortError') return problemFor('ABORTED', 0, {});
  // fetch/ofetch network failures: browser-specific English text, no response.
  if (e.name === 'TypeError' && /fetch|network|load failed/i.test(e.message ?? '')) return problemFor('NETWORK', 0, {});
  if (e.name === 'FetchError' && !(e.statusCode ?? e.status)) return problemFor('NETWORK', 0, {});
  // A NuxtError/H3Error without an API body (router 404, createError({ statusCode })).
  const status = e.statusCode ?? e.status;
  if (typeof status === 'number' && status >= 400) {
    const info = errorInfo(codeForStatus(status));
    return { code: info.code, status, title: info.title, message: fallback ?? info.message, fieldErrors: {}, retryable: info.retryable };
  }
  return problemFor('CLIENT', 0, { message: fallback });
}

function problemFor(code: ClientErrorCode, status: number, over: { message?: string }): Problem {
  const p = CLIENT_PROBLEMS[code];
  return { code, status, title: p.title, message: over.message ?? p.message, fieldErrors: {}, retryable: p.retryable };
}

function codeTitleFallback(status: number): string {
  return errorInfo(codeForStatus(status)).title;
}

/**
 * Message, request id and code for a toast or alert (kept for existing callers; new code uses
 * `normalizeError`).
 */
export function describeError(err: unknown, fallback = 'No se pudo completar la solicitud'): { message: string; requestId?: string; code?: string } {
  const p = normalizeError(err, fallback);
  return { message: p.message, requestId: p.requestId, code: p.code };
}
