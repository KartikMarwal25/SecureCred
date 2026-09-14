/**
 * Worker process entry point. Bootstraps its own pg Pool + ethers provider +
 * custodian signer + chain adapter (reusing the SAME adapter/repo modules as
 * the API via relative imports — no duplicated chain/DB logic), wires up the
 * event listener and reconciler, and shuts down gracefully on SIGTERM.
 */
import pg from 'pg';
import qrLib from 'qrcode';
import { config } from '../../api/src/lib/config.js';
import { logger } from '../../api/src/lib/logger.js';
import { createProvider } from '../../api/src/adapters/chain.adapter.js';
import { createCustodianSigner } from '../../api/src/adapters/custodianSigner.js';
import { createChainAdapter } from '../../api/src/adapters/chain.adapter.js';
import { createCertificateRepo } from '../../api/src/repositories/certificate.repo.js';
import { createFileRepo } from '../../api/src/repositories/file.repo.js';
import { createTxRepo } from '../../api/src/repositories/tx.repo.js';
import { createAuditRepo } from '../../api/src/repositories/audit.repo.js';
import { createWorkerCursorRepo } from '../../api/src/repositories/workerCursor.repo.js';
import { createUserRepo } from '../../api/src/repositories/user.repo.js';
import { createInstitutionRepo } from '../../api/src/repositories/institution.repo.js';
import { createBatchIssuanceRepo } from '../../api/src/repositories/batchIssuance.repo.js';
import { inTransaction } from '../../api/src/repositories/txHelper.js';
import { compile as pdfCompile } from '../../api/src/adapters/pdf.adapter.js';
import { createPinataAdapter } from '../../api/src/adapters/pinata.adapter.js';
import { createLifecycleService } from '../../api/src/services/lifecycleService.js';
import { createIssuanceService } from '../../api/src/services/issuanceService.js';
import { createBatchIssuanceService } from '../../api/src/services/batchIssuanceService.js';
import * as hashLib from '../../api/src/lib/hash.js';
import * as certIdLib from '../../api/src/lib/certId.js';
import { createEventListener } from './eventListener.js';
import { createReconciler } from './reconciler.js';
import { createBatchReconciler } from './batchReconciler.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const withTransaction = (fn) => inTransaction(pool, fn);
const provider = createProvider(config.rpcUrl);
const custodianSigner = createCustodianSigner({ config, provider, logger });
const signer = custodianSigner.connect();
const chainAdapter = createChainAdapter({ config, signer, logger });

const certificateRepo = createCertificateRepo({ pool });
const fileRepo = createFileRepo({ pool });
const txRepo = createTxRepo({ pool });
const auditRepo = createAuditRepo({ pool });
const workerCursorRepo = createWorkerCursorRepo({ pool });
const userRepo = createUserRepo({ pool });
const institutionRepo = createInstitutionRepo({ pool });
const batchIssuanceRepo = createBatchIssuanceRepo({ pool });

const pdfAdapter = { compile: pdfCompile };
const pinataAdapter = createPinataAdapter({ config, logger });

const lifecycleService = createLifecycleService({ certificateRepo, auditRepo, logger });

// The batch reconciler resumes a stalled job by re-running the SAME
// issuance pipeline the API uses for every row — never a separate/lighter
// implementation, so a resumed row goes through every persist-before-
// external-call guarantee issuanceService.js already provides.
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
const batchIssuanceService = createBatchIssuanceService({
  batchIssuanceRepo,
  issuanceService,
  certificateRepo,
  userRepo,
  logger,
});

const eventListener = createEventListener({
  chainAdapter,
  certificateRepo,
  txRepo,
  lifecycleService,
  workerCursorRepo,
  logger,
  config,
});

const reconciler = createReconciler({
  certificateRepo,
  fileRepo,
  txRepo,
  chainAdapter,
  lifecycleService,
  config,
  logger,
});

const batchReconciler = createBatchReconciler({ batchIssuanceService, config, logger });

const main = async () => {
  await eventListener.start();
  reconciler.start();
  batchReconciler.start();
  logger.info({ chainNetwork: config.chainNetwork }, 'SecureCred worker started');
};

main().catch((err) => {
  logger.error({ err }, 'worker failed to start');
  process.exitCode = 1;
});

const shutdown = (signal) => {
  logger.info({ signal }, 'worker shutting down');
  reconciler.stop();
  batchReconciler.stop();
  eventListener.stop();
  pool
    .end()
    .catch((err) => logger.error({ err }, 'error while closing pg pool'))
    .finally(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
