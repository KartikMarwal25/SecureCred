/**
 * The single composition root. Creates every concrete implementation (pg
 * Pool, ethers provider/signer, repositories, adapters, services) and wires
 * them together via their factory functions, exporting one frozen object
 * that routes/app.js consume. This is the ONLY file (besides tests) allowed
 * to wire concrete implementations together.
 *
 * Note on import-boundary rules D3/D4 ("only repositories/ imports 'pg'",
 * "only chain.adapter.js imports 'ethers'"): this composition root
 * necessarily constructs the `pg.Pool` and the ethers provider/signer
 * themselves (that's what a composition root is for) — it does so via
 * `pg` directly for the pool, and via chain.adapter.js's exported
 * `createProvider`/helpers for anything ethers-shaped, so `ethers` itself is
 * still only ever imported from chain.adapter.js.
 */
import pg from 'pg';
import { config } from './lib/config.js';
import { logger } from './lib/logger.js';

import { createCertificateRepo } from './repositories/certificate.repo.js';
import { createFileRepo } from './repositories/file.repo.js';
import { createTxRepo } from './repositories/tx.repo.js';
import { createRevocationRepo } from './repositories/revocation.repo.js';
import { createUserRepo } from './repositories/user.repo.js';
import { createInstitutionRepo } from './repositories/institution.repo.js';
import { createAuditRepo } from './repositories/audit.repo.js';
import { createVerificationLogRepo } from './repositories/verificationLog.repo.js';
import { inTransaction } from './repositories/txHelper.js';

import { compile as pdfCompile } from './adapters/pdf.adapter.js';
import { createPinataAdapter } from './adapters/pinata.adapter.js';
import { createChainAdapter, createProvider } from './adapters/chain.adapter.js';
import { createCustodianSigner } from './adapters/custodianSigner.js';
import { createClerkAdapter } from './adapters/clerk.adapter.js';

import { createIssuanceService } from './services/issuanceService.js';
import { createVerificationService } from './services/verificationService.js';
import { createRevocationService } from './services/revocationService.js';
import { createLifecycleService } from './services/lifecycleService.js';

import { createRequireAuth } from './middleware/auth.mw.js';
import { createRateLimiter, byIp, byInstitution } from './middleware/rate-limiter.mw.js';

import * as hashLib from './lib/hash.js';
import * as certIdLib from './lib/certId.js';
import qrLib from 'qrcode';

/**
 * Builds the full production dependency graph.
 *
 * @returns {object} Frozen container consumed by app.js/server.js.
 */
export const createContainer = () => {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const withTransaction = (fn) => inTransaction(pool, fn);

  const provider = createProvider(config.rpcUrl);
  const custodianSigner = createCustodianSigner({ config, provider, logger });
  const signer = custodianSigner.connect();

  const certificateRepo = createCertificateRepo({ pool });
  const fileRepo = createFileRepo({ pool });
  const txRepo = createTxRepo({ pool });
  const revocationRepo = createRevocationRepo({ pool });
  const userRepo = createUserRepo({ pool });
  const institutionRepo = createInstitutionRepo({ pool });
  const auditRepo = createAuditRepo({ pool });
  const verificationLogRepo = createVerificationLogRepo({ pool, logger });

  const pdfAdapter = { compile: pdfCompile };
  const pinataAdapter = createPinataAdapter({ config, logger });
  const chainAdapter = createChainAdapter({ config, signer, logger });
  const clerkAdapter = createClerkAdapter({ config, logger });

  const lifecycleService = createLifecycleService({ certificateRepo, auditRepo, logger });
  const issuanceService = createIssuanceService({
    certificateRepo,
    fileRepo,
    txRepo,
    userRepo,
    institutionRepo,
    pdfAdapter,
    pinataAdapter,
    chainAdapter,
    hashLib,
    certIdLib,
    qrLib,
    lifecycleService,
    auditRepo,
    config,
    logger,
    withTransaction,
  });
  const verificationService = createVerificationService({
    certificateRepo,
    chainAdapter,
    pinataAdapter,
    verificationLogRepo,
    txRepo,
    hashLib,
    config,
    logger,
  });
  const revocationService = createRevocationService({
    certificateRepo,
    revocationRepo,
    txRepo,
    chainAdapter,
    lifecycleService,
    auditRepo,
    config,
    withTransaction,
  });

  const requireAuth = createRequireAuth({ clerkAdapter });

  const rateLimiters = {
    issuanceLimiter: createRateLimiter({
      windowMs: 60 * 60 * 1000,
      max: config.rateLimits.issuancePerHour,
      keyFn: byInstitution,
    }),
    revocationLimiter: createRateLimiter({
      windowMs: 60 * 60 * 1000,
      max: config.rateLimits.revocationPerHour,
      keyFn: byInstitution,
    }),
    verifyMinuteLimiter: createRateLimiter({
      windowMs: 60 * 1000,
      max: config.rateLimits.verifyPerMinute,
      keyFn: byIp,
    }),
    verifyHourLimiter: createRateLimiter({
      windowMs: 60 * 60 * 1000,
      max: config.rateLimits.verifyPerHour,
      keyFn: byIp,
    }),
    authLimiter: createRateLimiter({
      windowMs: 60 * 1000,
      max: config.rateLimits.authPerMinute,
      keyFn: byIp,
    }),
  };

  return Object.freeze({
    config,
    logger,
    pool,
    provider,
    custodianSigner,
    repos: Object.freeze({
      certificateRepo,
      fileRepo,
      txRepo,
      revocationRepo,
      userRepo,
      institutionRepo,
      auditRepo,
      verificationLogRepo,
    }),
    adapters: Object.freeze({ pdfAdapter, pinataAdapter, chainAdapter, clerkAdapter }),
    services: Object.freeze({ issuanceService, verificationService, revocationService, lifecycleService }),
    certificateRepo,
    fileRepo,
    txRepo,
    pinataAdapter,
    issuanceService,
    verificationService,
    revocationService,
    userRepo,
    clerkAdapter,
    requireAuth,
    ...rateLimiters,
    /** Gracefully closes the pool (called from server.js's SIGTERM handler). */
    close: () => pool.end(),
  });
};
