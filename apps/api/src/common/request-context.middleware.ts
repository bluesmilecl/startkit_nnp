import { Injectable, type NestMiddleware } from '@nestjs/common';
import { newRequestId, runWithContext } from '@starter/observability';
import type { NextFunction, Request, Response } from 'express';

const VALID_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Assigns a correlation id (x-request-id) propagated to logs, AI usage and jobs. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && VALID_ID.test(incoming) ? incoming : newRequestId();
    res.setHeader('x-request-id', requestId);
    runWithContext({ requestId }, () => next());
  }
}
