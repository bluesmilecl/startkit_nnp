import { describe, expect, it } from 'vitest';
import { ErrorCodes } from './common.js';
import { AppError, codeForStatus, ERROR_CATALOG, ERROR_STATUS, errorInfo, isAppError, isRetryableError, retryAfterOf } from './errors.js';

describe('error catalog', () => {
  it('covers every code with a status, Spanish copy, retry policy and log level', () => {
    expect(Object.keys(ERROR_CATALOG).sort()).toEqual([...ErrorCodes].sort());
    for (const code of ErrorCodes) {
      const e = ERROR_CATALOG[code];
      expect(e.status, code).toBeGreaterThanOrEqual(400);
      expect(e.title.length, code).toBeGreaterThan(3);
      expect(e.message, code).toMatch(/\.$/);
      expect(ERROR_STATUS[code]).toBe(e.status);
      // 5xx need attention; 4xx are expected outcomes (rate limits are worth a warning).
      expect(e.log, code).toBe(e.status >= 500 ? (code === 'INTERNAL' ? 'error' : 'warn') : code === 'RATE_LIMITED' ? 'warn' : 'info');
    }
    expect(ErrorCodes.filter((c) => ERROR_CATALOG[c].retryable).sort()).toEqual(['INTERNAL', 'RATE_LIMITED', 'TIMEOUT', 'UNAVAILABLE', 'UPSTREAM_ERROR']);
  });

  it('maps statuses and unknown codes', () => {
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(409)).toBe('CONFLICT');
    expect(codeForStatus(422)).toBe('VALIDATION_FAILED');
    expect(codeForStatus(503)).toBe('UNAVAILABLE');
    expect(codeForStatus(418)).toBe('BAD_REQUEST');
    expect(codeForStatus(599)).toBe('INTERNAL');
    expect(errorInfo('SOMETHING_NEW')).toMatchObject({ code: 'INTERNAL', status: 500 });
    expect(errorInfo('FORBIDDEN')).toMatchObject({ code: 'FORBIDDEN', status: 403, retryable: false });
  });
});

describe('AppError', () => {
  it('builds catalog errors with helpers', () => {
    expect(AppError.notFound('Proyecto').message).toBe('Proyecto no encontrado');
    expect(AppError.notFound('Colección', 'f').message).toBe('Colección no encontrada');
    const field = AppError.field('name', 'Ya existe', 'CONFLICT');
    expect(field).toMatchObject({ code: 'CONFLICT', status: 409, details: [{ path: 'name', message: 'Ya existe' }] });
    expect(AppError.rateLimited(undefined, 30)).toMatchObject({ code: 'RATE_LIMITED', status: 429, details: { retryAfterSeconds: 30 } });
    expect(AppError.unavailable()).toMatchObject({ status: 503, retryable: true });
    expect(isAppError(AppError.unsupported('x'))).toBe(true);
    // Duck-typed across package copies (name check).
    expect(isAppError({ name: 'AppError', code: 'FORBIDDEN' })).toBe(true);
  });

  it('keeps the cause for logs only and lets the thrower override retryability', () => {
    const cause = new Error('ECONNRESET at 10.0.0.3');
    const e = AppError.upstream('El proveedor falló', { cause, retryable: false });
    expect(e.cause).toBe(cause);
    expect(e.retryable).toBe(false);
    expect(JSON.stringify({ code: e.code, message: e.message, details: e.details })).not.toContain('10.0.0.3');
  });

  it('classifies retryable failures', () => {
    expect(isRetryableError(AppError.forbidden())).toBe(false);
    expect(isRetryableError(AppError.notFound('Documento'))).toBe(false);
    expect(isRetryableError(new AppError('UPSTREAM_ERROR', 'x'))).toBe(true);
    expect(isRetryableError(new AppError('UPSTREAM_ERROR', 'x', undefined, { retryable: false }))).toBe(false);
    expect(isRetryableError(AppError.timeout())).toBe(true);
    // Unknown failures (driver, network, bugs) get bounded retries.
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableError({ name: 'AppError', code: 'VALIDATION_FAILED' })).toBe(false);
  });

  it('reads Retry-After from details', () => {
    expect(retryAfterOf(AppError.rateLimited(undefined, 2.2))).toBe(3);
    expect(retryAfterOf(AppError.unavailable())).toBeUndefined();
    expect(retryAfterOf(new Error('x'))).toBeUndefined();
  });
});
