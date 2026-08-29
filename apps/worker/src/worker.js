/**
 * Worker process entry point. Bootstraps its own pg Pool + ethers provider +
 * custodian signer + chain adapter (reusing the SAME adapter/repo modules as
 * the API via relative imports — no duplicated chain/DB logic), wires up the
 * event listener and reconciler, and shuts down gracefully on SIGTERM.
 */
import pg from 'pg';
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
import { createLifecycleService } from '../../api/src/services/lifecycleService.js';
import { createEventListener } from './eventListener.js';
import { createReconciler } from './reconciler.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const provider = createProvider(config.rpcUrl);
const custodianSigner = createCustodianSigner({ config, provider, logger });
const signer = custodianSigner.connect();
const chainAdapter = createChainAdapter({ config, signer, logger });

const certificateRepo = createCertificateRepo({ pool });
const fileRepo = createFileRepo({ pool });
const txRepo = createTxRepo({ pool });
const auditRepo = createAuditRepo({ pool });
const workerCursorRepo = createWorkerCursorRepo({ pool });

const lifecycleService = createLifecycleService({ certificateRepo, auditRepo, logger });

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

const main = async () => {
  await eventListener.start();
  reconciler.start();
  logger.info({ chainNetwork: config.chainNetwork }, 'SecureCred worker started');
};

main().catch((err) => {
  logger.error({ err }, 'worker failed to start');
  process.exitCode = 1;
});

const shutdown = (signal) => {
  logger.info({ signal }, 'worker shutting down');
  reconciler.stop();
  eventListener.stop();
  pool
    .end()
    .catch((err) => logger.error({ err }, 'error while closing pg pool'))
    .finally(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
