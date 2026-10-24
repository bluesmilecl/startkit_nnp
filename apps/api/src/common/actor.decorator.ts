import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Actor } from '@starter/auth';
import { AppError } from '@starter/contracts';
import type { Request } from 'express';

export interface AuthedRequest extends Request {
  actor?: Actor;
}

/** The authenticated actor resolved by the global AccessGuard. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.actor) throw new AppError('UNAUTHENTICATED', 'Sesión requerida');
  return req.actor;
});
