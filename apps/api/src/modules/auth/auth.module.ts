import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  AuditQueryService,
  createAdminExecutors,
  createAuth,
  InvitationsService,
  OrganizationsService,
  ProposalsService,
  RolesService,
  SessionsService,
  SettingsService,
  UsersService,
  type AccessDeps,
  type AccessEvent,
} from '@starter/auth';
import type { Env, FeatureFlags } from '@starter/config';
import type { DbHandle } from '@starter/db';
import type { Mailer } from '@starter/mail';
import { ACCESS_DEPS, AUTH, DB, ENV, FEATURES, MAILER } from '../../infra/tokens.js';
import { AccessGuard } from './access.guard.js';
import { AccessEventsService } from './access-events.service.js';
import { MeController } from './me.controller.js';
import { PublicController } from './public.controller.js';

const services = [UsersService, RolesService, InvitationsService, SessionsService, SettingsService, OrganizationsService, AuditQueryService];

@Global()
@Module({
  controllers: [MeController, PublicController],
  providers: [
    AccessEventsService,
    {
      provide: ACCESS_DEPS,
      inject: [DB, ENV, FEATURES, MAILER, AccessEventsService],
      useFactory: (db: DbHandle, env: Env, features: FeatureFlags, mailer: Mailer, events: AccessEventsService) =>
        ({ db: db.db, env, features, mailer, onEvent: (e: AccessEvent) => events.handle(e) }) satisfies AccessDeps,
    },
    {
      provide: AUTH,
      inject: [DB, ENV, FEATURES, MAILER],
      useFactory: (db: DbHandle, env: Env, features: FeatureFlags, mailer: Mailer) => createAuth({ db: db.db, env, mailer, features }),
    },
    ...services.map((S) => ({ provide: S, inject: [ACCESS_DEPS], useFactory: (deps: AccessDeps) => new S(deps) })),
    {
      provide: ProposalsService,
      inject: [ACCESS_DEPS],
      useFactory: (deps: AccessDeps) => new ProposalsService(deps, createAdminExecutors(deps)),
    },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AUTH, ACCESS_DEPS, ProposalsService, AccessEventsService, ...services],
})
export class AuthModule {}
