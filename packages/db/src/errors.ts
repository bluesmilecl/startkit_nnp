import { AppError } from '@starter/contracts';

/** The parts of a node-postgres error the mapping needs (Drizzle wraps it in `cause`). */
export interface PgErrorInfo {
  code: string;
  constraint?: string;
  table?: string;
  column?: string;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH']);

/** Finds the PostgreSQL (or socket) error inside wrappers such as DrizzleQueryError. */
export function pgErrorOf(err: unknown): PgErrorInfo | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; table?: unknown; column?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && (SQLSTATE.test(e.code) || CONNECTION_CODES.has(e.code))) {
      return {
        code: e.code,
        constraint: typeof e.constraint === 'string' ? e.constraint : undefined,
        table: typeof e.table === 'string' ? e.table : undefined,
        column: typeof e.column === 'string' ? e.column : undefined,
      };
    }
    current = e.cause;
  }
  if (err instanceof Error && /Connection terminated|connection timeout|timeout exceeded when trying to connect/i.test(err.message)) return { code: 'ECONNRESET' };
  return null;
}

/** Unique violation (23505), optionally for one named constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = pgErrorOf(err);
  return pg?.code === '23505' && (!constraint || pg.constraint === constraint);
}

/** Foreign key violation (23503), optionally for one named constraint. */
export function isForeignKeyViolation(err: unknown, constraint?: string): boolean {
  const pg = pgErrorOf(err);
  return pg?.code === '23503' && (!constraint || pg.constraint === constraint);
}

/**
 * Translates database failures that reach the edge (API filter, CLI) into catalog errors so the
 * person never sees a 500 for a race or a dropped connection. Messages are generic on purpose:
 * services that know the meaning of a constraint should catch it first (`isUniqueViolation`) and
 * throw a field-level AppError. Returns null for anything that is not a database error.
 */
export function mapDatabaseError(err: unknown): AppError | null {
  const pg = pgErrorOf(err);
  if (!pg) return null;
  const opts = { cause: err };
  switch (pg.code) {
    case '23505':
      return new AppError('CONFLICT', 'Ya existe un registro con esos datos.', undefined, opts);
    case '23503':
      return new AppError('CONFLICT', 'La operación no es posible porque hay datos relacionados.', undefined, opts);
    case '23502':
    case '23514':
    case '22001':
    case '22003':
      return new AppError('VALIDATION_FAILED', 'Los datos no cumplen las reglas del sistema.', undefined, opts);
    case '22P02':
    case '22007':
    case '22008':
      return new AppError('BAD_REQUEST', 'Algún identificador o valor tiene un formato inválido.', undefined, opts);
    case '40001':
    case '40P01':
    case '55P03':
      return new AppError('UNAVAILABLE', 'Hubo operaciones simultáneas sobre los mismos datos; intenta de nuevo.', { retryAfterSeconds: 1 }, opts);
    case '57014':
      return new AppError('TIMEOUT', 'La consulta tardó demasiado y se canceló.', undefined, opts);
    default:
      // 08xxx connection exceptions, 53xxx insufficient resources, 57P0x shutdown, socket errors.
      if (CONNECTION_CODES.has(pg.code) || /^(08|53|57P)/.test(pg.code)) {
        return new AppError('UNAVAILABLE', 'La base de datos no está disponible en este momento; intenta de nuevo en unos segundos.', { retryAfterSeconds: 5 }, opts);
      }
      return null;
  }
}
