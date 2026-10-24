export * from './client.js';
export * from './migrate.js';
export * from './schema/index.js';
export * from './pagination.js';
export * from './errors.js';
export { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, not, notInArray, or, sql, count, sum, exists, type SQL } from 'drizzle-orm';

import { getTableName, sql as rawSql, type Column, type SQL as RawSQL } from 'drizzle-orm';

/**
 * Fully qualified column reference ("table"."column") for correlated subqueries. Drizzle renders
 * columns unqualified in single-table selects, which inside a subquery silently binds to the
 * inner table (e.g. `m.connection_id = "id"`). Always use this for outer references.
 */
export function outerRef(column: Column): RawSQL {
  return rawSql`${rawSql.identifier(getTableName(column.table))}.${rawSql.identifier(column.name)}`;
}
