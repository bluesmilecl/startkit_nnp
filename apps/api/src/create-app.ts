import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Auth } from '@starter/auth';
import { getEnv, type FeatureFlags } from '@starter/config';
import type { DbHandle } from '@starter/db';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { ErrorFilter } from './common/error.filter.js';
import { requestContext } from './common/request-context.middleware.js';
import { ResponseValidationInterceptor } from './common/response-validation.interceptor.js';
import { AUTH, DB, FEATURES } from './infra/tokens.js';
import { setupOpenApiDocs } from './modules/system/openapi-docs.js';

export interface CreateAppOptions {
  logger?: boolean;
  /** Skip Swagger UI setup (used by the OpenAPI generator script). */
  docs?: boolean;
}

/**
 * Creates the Nest application. Body parsing is disabled globally so that the Better Auth
 * handler receives the raw request; JSON parsing is enabled after it for every other route.
 */
export async function createApp(opts: CreateAppOptions = {}): Promise<INestApplication> {
  const env = getEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: opts.logger === false ? false : ['error', 'warn'],
    abortOnError: false,
  });
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(
    helmet({
      contentSecurityPolicy: false, // HTML pages are served by Nuxt; Swagger UI needs inline assets
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  const auth = app.get<Auth>(AUTH);
  // Better Auth handler first (it parses its own body), then JSON for the business API.
  const authHandler = toNodeHandler(auth);
  app.use('/api/auth', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    authHandler(req, res).catch(next);
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ErrorFilter());
  app.useGlobalInterceptors(
    new ResponseValidationInterceptor(env.NODE_ENV === 'production' ? 'off' : env.NODE_ENV === 'test' ? 'strict' : 'warn'),
  );
  if (opts.docs !== false) {
    await setupOpenApiDocs(app, { auth, env, db: app.get<DbHandle>(DB), features: app.get<FeatureFlags>(FEATURES) });
  }
  app.enableShutdownHooks();
  return app;
}
