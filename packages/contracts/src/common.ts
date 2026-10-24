import { z } from 'zod';

export const IsoDate = z.iso.datetime({ offset: true }).meta({ description: 'ISO-8601 timestamp (UTC)' });
export const Uuid = z.uuid();
/** Decimal USD amount serialized as string to avoid binary floating point. */
export const UsdAmount = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .meta({ id: 'UsdAmount', description: 'Decimal amount in USD, serialized as string', example: '0.001250000000' });

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().meta({ example: 'FORBIDDEN', description: 'Stable machine code from the error catalog (docs/errors.md); branch on this, never on the message' }),
      message: z.string().meta({ description: 'Spanish message safe to show to the person' }),
      details: z.unknown().optional().meta({
        description:
          'Code-specific data: VALIDATION_FAILED → [{ path, message, code }]; PRECONDITION_FAILED → { currentVersion }; RATE_LIMITED/UNAVAILABLE → { retryAfterSeconds }',
      }),
      requestId: z.string().optional().meta({ description: 'Same value as the x-request-id header; quote it to support' }),
    }),
  })
  .meta({ id: 'ErrorResponse' });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const OkResponse = z.object({ ok: z.literal(true) }).meta({ id: 'OkResponse' });

export const IdParams = z.object({ id: Uuid });

/** Boolean query parameter: accepts true/false/1/0 strings (z.coerce.boolean would read "false" as true). */
export const QueryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const PageMeta = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  pageCount: z.number().int(),
});

export function pageOf<T extends z.ZodType>(item: T, id: string) {
  return PageMeta.extend({ items: z.array(item) }).meta({ id });
}

export const SortDirection = z.enum(['asc', 'desc']);

export const JobAccepted = z
  .object({ jobId: Uuid, status: z.string() })
  .meta({ id: 'JobAccepted', description: 'Long running work was queued; poll the job for progress' });

/** Error codes returned by the API. */
export const ErrorCodes = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PRECONDITION_FAILED',
  'GONE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'BUDGET_EXCEEDED',
  'FEATURE_DISABLED',
  'NOT_CONFIGURED',
  'CAPABILITY_UNSUPPORTED',
  'UPSTREAM_ERROR',
  'UNAVAILABLE',
  'TIMEOUT',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ErrorCodes)[number];
