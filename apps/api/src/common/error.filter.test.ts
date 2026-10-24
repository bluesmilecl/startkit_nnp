import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { AppError } from '@starter/contracts';
import { describe, expect, it } from 'vitest';
import { classifyError, errorBody } from './error.filter.js';

describe('API error classification', () => {
  it('keeps domain errors as thrown, details included', () => {
    const c = classifyError(AppError.field('name', 'Ya existe un proyecto con ese nombre', 'CONFLICT'));
    expect(c).toMatchObject({ origin: 'app', log: 'info', error: { code: 'CONFLICT', status: 409 } });
    expect(errorBody(c, 'req-1')).toEqual({ error: { code: 'CONFLICT', message: 'Ya existe un proyecto con ese nombre', details: [{ path: 'name', message: 'Ya existe un proyecto con ese nombre' }], requestId: 'req-1' } });
    expect(classifyError(new AppError('UPSTREAM_ERROR', 'x')).log).toBe('warn');
  });

  it('replaces framework text (English, internal paths) with the catalog message', () => {
    const notFound = classifyError(new NotFoundException('Cannot GET /api/internal/thing'));
    expect(notFound).toMatchObject({ origin: 'framework', error: { code: 'NOT_FOUND', message: 'Lo que buscas no existe o ya no está disponible.' } });
    expect(errorBody(notFound, undefined).error).not.toHaveProperty('details');
    expect(classifyError(new PayloadTooLargeException('File too large')).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(classifyError(new BadRequestException("Unexpected token } in JSON at position 3")).error).toMatchObject({ code: 'BAD_REQUEST', message: 'La solicitud no tiene un formato válido.' });
  });

  it('turns body-parser failures into 4xx instead of 500', () => {
    const parse = Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed', status: 400 });
    expect(classifyError(parse)).toMatchObject({ origin: 'body', error: { code: 'BAD_REQUEST', message: 'El cuerpo de la solicitud no es JSON válido.' } });
    expect(classifyError(Object.assign(new Error('too large'), { type: 'entity.too.large', status: 413 })).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(classifyError(Object.assign(new Error('charset'), { type: 'charset.unsupported', status: 415 })).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('maps database races and outages, warning in the log', () => {
    const race = Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'agents_org_key_uq' }) });
    expect(classifyError(race)).toMatchObject({ origin: 'database', log: 'warn', error: { code: 'CONFLICT', status: 409 } });
    const down = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(classifyError(down)).toMatchObject({ origin: 'database', log: 'error', error: { code: 'UNAVAILABLE', status: 503 } });
  });

  it('hides unknown failures behind INTERNAL with a generic Spanish message', () => {
    const c = classifyError(new TypeError("Cannot read properties of undefined (reading 'id') at /srv/app/secret.js"));
    expect(c).toMatchObject({ origin: 'unknown', log: 'error', error: { code: 'INTERNAL', status: 500 } });
    const body = errorBody(c, 'req-9');
    expect(body.error.message).toBe('Ocurrió un error inesperado. Si persiste, comparte el código de solicitud con soporte.');
    expect(JSON.stringify(body)).not.toMatch(/undefined|secret|srv/);
  });
});
