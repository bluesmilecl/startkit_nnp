import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { trustedOrigins, type Env } from '@starter/config';
import type { NextFunction, Request, Response } from 'express';
import { ENV } from '../../infra/tokens.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Origin validation for state-changing requests on the business API (Better Auth applies its own
 * checks to /api/auth). Session cookies are SameSite=Lax and HttpOnly; together with this check
 * cross-site requests cannot mutate data with the user's cookies.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly allowed: Set<string>;
  constructor(@Inject(ENV) env: Env) {
    this.allowed = new Set(trustedOrigins(env));
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (SAFE.has(req.method)) return next();
    const origin = req.header('origin') ?? refererOrigin(req.header('referer'));
    const fetchSite = req.header('sec-fetch-site');
    if ((origin && !this.allowed.has(origin)) || fetchSite === 'cross-site') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Origen no permitido' } });
      return;
    }
    next();
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
