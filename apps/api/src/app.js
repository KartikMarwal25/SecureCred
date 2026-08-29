/**
 * Builds the Express application. Exported as a factory so tests can inject
 * a fake/substitute container instead of the real one (no live DB/chain/
 * Clerk/Pinata required to exercise routing, validation, and error handling).
 *
 * Middleware order is load-bearing: cors -> helmet -> requestId -> the
 * webhooks router's raw-body route (registered before the global JSON body
 * parser, so Clerk's signature can be verified over untouched bytes) ->
 * express.json() -> pino-http request logging -> routers -> errorHandler
 * (registered LAST, so it catches everything upstream).
 */
import express from 'express';
import pinoHttp from 'pino-http';
import { createCorsMiddleware } from './middleware/cors.mw.js';
import { createSecurityHeadersMiddleware } from './middleware/security-headers.mw.js';
import { requestId } from './middleware/request-id.mw.js';
import { createErrorHandler } from './middleware/error-handler.mw.js';
import { createCertificatesRouter } from './routes/certificates.routes.js';
import { createStudentsRouter } from './routes/students.routes.js';
import { createInstitutionsRouter } from './routes/institutions.routes.js';
import { createWebhooksRouter } from './routes/webhooks.routes.js';
import { createHealthRouter } from './routes/health.routes.js';

/**
 * @param {object} deps - A container (real or substitute) exposing config,
 *   logger, requireAuth, rate limiters, repos, services, adapters, pool,
 *   provider, custodianSigner (see container.js for the real shape).
 * @returns {import('express').Express}
 */
export const createApp = (deps) => {
  const { config, logger } = deps;
  const app = express();

  app.use(createCorsMiddleware(config));
  app.use(createSecurityHeadersMiddleware());
  app.use(requestId());

  // Mounted BEFORE express.json() — see module comment.
  app.use(
    '/api/v1/webhooks',
    createWebhooksRouter({ clerkAdapter: deps.clerkAdapter, userRepo: deps.userRepo, logger }),
  );

  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use(
    '/api/v1/certificates',
    createCertificatesRouter({
      issuanceService: deps.issuanceService,
      verificationService: deps.verificationService,
      revocationService: deps.revocationService,
      certificateRepo: deps.certificateRepo,
      fileRepo: deps.fileRepo,
      txRepo: deps.txRepo,
      pinataAdapter: deps.pinataAdapter,
      requireAuth: deps.requireAuth,
      issuanceLimiter: deps.issuanceLimiter,
      revocationLimiter: deps.revocationLimiter,
      verifyMinuteLimiter: deps.verifyMinuteLimiter,
      verifyHourLimiter: deps.verifyHourLimiter,
      config,
    }),
  );

  app.use(
    '/api/v1/students',
    createStudentsRouter({ certificateRepo: deps.certificateRepo, requireAuth: deps.requireAuth }),
  );

  app.use(
    '/api/v1/institutions',
    createInstitutionsRouter({
      verificationLogRepo: deps.repos?.verificationLogRepo,
      requireAuth: deps.requireAuth,
    }),
  );

  app.use(
    '/api/v1/health',
    createHealthRouter({
      pool: deps.pool,
      pinataAdapter: deps.pinataAdapter,
      provider: deps.provider ?? null,
      custodianSigner: deps.custodianSigner ?? null,
    }),
  );

  app.use(createErrorHandler({ logger }));

  return app;
};
