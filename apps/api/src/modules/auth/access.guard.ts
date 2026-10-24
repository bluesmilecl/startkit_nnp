import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { loadActor, recordAudit, type Auth } from '@starter/auth';
import type { FeatureFlags } from '@starter/config';
import { AppError } from '@starter/contracts';
import type { DbHandle } from '@starter/db';
import { currentContext, setContextValue } from '@starter/observability';
import { fromNodeHeaders } from 'better-auth/node';
import type { AuthedRequest } from '../../common/actor.decorator.js';
import { getEndpointOptions } from '../../common/endpoint.js';
import { AUTH, DB, FEATURES } from '../../infra/tokens.js';

/**
 * Global guard: every route declares `@Endpoint`; routes without it are denied (deny by default).
 * Resolves the Better Auth session, loads the actor (roles/permissions fresh from the database)
 * and enforces declared permissions and feature modules. Handlers still re-check in services.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: DbHandle,
    @Inject(FEATURES) private readonly features: FeatureFlags,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const options = getEndpointOptions(ctx);
    if (!options) throw AppError.forbidden('Operación sin contrato declarado');
    if (options.feature && !this.features[options.feature]) {
      throw new AppError('FEATURE_DISABLED', `El módulo ${options.feature} está desactivado`);
    }
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (options.public) {
      await this.tryAttachActor(req);
      return true;
    }
    const actor = await this.tryAttachActor(req);
    if (!actor) throw new AppError('UNAUTHENTICATED', 'Sesión requerida o vencida');
    const required = [options.permission ?? []].flat();
    const missing = required.filter((p) => !actor.permissions.has(p));
    if (missing.length) {
      if (req.method !== 'GET') {
        await recordAudit(this.db.db, actor, {
          action: options.operationId,
          resourceType: 'endpoint',
          resourceId: `${req.method} ${req.route?.path ?? req.path}`,
          outcome: 'denied',
          metadata: { missing },
        });
      }
      throw AppError.forbidden(`Permiso requerido: ${missing.join(', ')}`, { missing });
    }
    return true;
  }

  private async tryAttachActor(req: AuthedRequest) {
    if (req.actor) return req.actor;
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return undefined;
    const headerOrg = req.header('x-organization-id');
    const sessionOrg = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
    req.actor = await loadActor(
      { db: this.db.db, features: this.features },
      {
        userId: session.user.id,
        organizationId: headerOrg ?? sessionOrg ?? null,
        channel: 'panel',
        sessionId: session.session.id,
        requestId: currentContext()?.requestId,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      },
    );
    setContextValue('userId', req.actor.userId);
    setContextValue('organizationId', req.actor.organizationId);
    return req.actor;
  }
}
