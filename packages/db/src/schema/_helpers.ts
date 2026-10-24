import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** UTC timestamp with time zone, JS Date in application code. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const id = () => uuid('id').primaryKey().defaultRandom();

/** Internal workspace used when the organizations module is disabled. */
export const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Money amounts are stored as NUMERIC(24,12) USD and handled as strings in TypeScript;
 * arithmetic is done with the bigint helpers in @starter/ai (never binary floats).
 */
export const money = (name: string) =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return 'numeric(24, 12)';
    },
  })(name);

/** PostgreSQL tsvector column (full-text search). */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/** Dimension-less pgvector column; dimension is enforced per embedding profile. */
export const anyVector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(',')
      .filter(Boolean)
      .map(Number);
  },
});
