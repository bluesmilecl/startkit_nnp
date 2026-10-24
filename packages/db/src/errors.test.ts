import { describe, expect, it } from 'vitest';
import { isForeignKeyViolation, isUniqueViolation, mapDatabaseError, pgErrorOf } from './errors.js';

const pg = (code: string, extra: Record<string, string> = {}) => Object.assign(new Error(`pg ${code}`), { code, severity: 'ERROR', ...extra });
/** Drizzle wraps driver errors: DrizzleQueryError { cause: <pg error> }. */
const wrapped = (cause: unknown) => Object.assign(new Error('Failed query: insert into …'), { cause });

describe('database error mapping', () => {
  it('finds the driver error inside wrappers', () => {
    expect(pgErrorOf(wrapped(pg('23505', { constraint: 'projects_org_name_uq', table: 'projects' })))).toEqual({ code: '23505', constraint: 'projects_org_name_uq', table: 'projects', column: undefined });
    expect(pgErrorOf(new Error('plain'))).toBeNull();
    expect(pgErrorOf({ code: 'FORBIDDEN' })).toBeNull();
  });

  it('recognizes unique and foreign key violations by constraint', () => {
    const dup = wrapped(pg('23505', { constraint: 'projects_org_name_uq' }));
    expect(isUniqueViolation(dup)).toBe(true);
    expect(isUniqueViolation(dup, 'projects_org_name_uq')).toBe(true);
    expect(isUniqueViolation(dup, 'agents_org_key_uq')).toBe(false);
    expect(isForeignKeyViolation(wrapped(pg('23503', { constraint: 'x_fk' })), 'x_fk')).toBe(true);
  });

  it('maps races, bad input and outages to catalog errors (never INTERNAL)', () => {
    expect(mapDatabaseError(wrapped(pg('23505')))).toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(mapDatabaseError(pg('23503'))).toMatchObject({ code: 'CONFLICT' });
    expect(mapDatabaseError(pg('23502'))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mapDatabaseError(pg('22P02'))).toMatchObject({ code: 'BAD_REQUEST' });
    expect(mapDatabaseError(pg('40P01'))).toMatchObject({ code: 'UNAVAILABLE', retryable: true, details: { retryAfterSeconds: 1 } });
    expect(mapDatabaseError(pg('57014'))).toMatchObject({ code: 'TIMEOUT' });
    expect(mapDatabaseError(pg('57P01'))).toMatchObject({ code: 'UNAVAILABLE' });
    expect(mapDatabaseError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }))).toMatchObject({ code: 'UNAVAILABLE' });
    expect(mapDatabaseError(new Error('Connection terminated unexpectedly'))).toMatchObject({ code: 'UNAVAILABLE' });
    expect(mapDatabaseError(pg('42P01'))).toBeNull(); // undefined table: a bug, stays INTERNAL
    expect(mapDatabaseError(new TypeError('x is undefined'))).toBeNull();
  });

  it('never exposes SQL, constraint names or values in the message', () => {
    const e = mapDatabaseError(wrapped(pg('23505', { constraint: 'projects_org_name_uq', detail: 'Key (lower(name))=(secreto) already exists.' })))!;
    expect(e.message).not.toMatch(/projects|secreto|Key/);
    expect(e.details).toBeUndefined();
  });
});
