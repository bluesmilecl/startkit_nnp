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
      code: z.string().meta({ example: 'FORBIDDEN' }),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const OkResponse = z.object({ ok: z.literal(true) }).meta({ id: 'OkResponse' });

export const IdParams = z.object({ id: Uuid });

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
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ErrorCodes)[number];
