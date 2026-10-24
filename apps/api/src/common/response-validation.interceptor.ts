import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { createLogger } from '@starter/observability';
import { map, type Observable } from 'rxjs';
import { getEndpointOptions } from './endpoint.js';

const log = createLogger('api-contract');

/**
 * Outside production, validates each JSON response against its documented schema so that the
 * OpenAPI contract cannot silently drift from the real API. In test it fails the request.
 */
@Injectable()
export class ResponseValidationInterceptor implements NestInterceptor {
  constructor(private readonly mode: 'off' | 'warn' | 'strict') {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = getEndpointOptions(ctx);
    const schema = options?.response.schema;
    if (this.mode === 'off' || !schema || options?.response.contentType) return next.handle();
    return next.handle().pipe(
      map((value: unknown) => {
        if (value === undefined) return value;
        const wire = JSON.parse(JSON.stringify(value)) as unknown;
        const result = schema.safeParse(wire);
        if (!result.success) {
          const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);
          log.error({ operationId: options.operationId, issues }, 'response does not match contract');
          if (this.mode === 'strict') throw new Error(`Response contract violation in ${options.operationId}: ${issues.join('; ')}`);
        }
        return value;
      }),
    );
  }
}
