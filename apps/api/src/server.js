/**
 * Process entry point: builds the real container, boots the Express app,
 * and shuts down gracefully on SIGTERM (closes the HTTP server, then the pg pool).
 *
 * Normally the reconciler/event listener/batch resumer run in apps/worker
 * as their own separate process (see docker-compose.yml's `worker`
 * service). When RUN_WORKER_INLINE=true (set only where there is no
 * separate worker process available at all — e.g. a single free-tier host
 * with no background-worker service type), this same process starts those
 * jobs too, reusing the exact same modules apps/worker runs, not a
 * separate/lighter implementation.
 */
import { createContainer } from './container.js';
import { createApp } from './app.js';
import { createWorkerCursorRepo } from './repositories/workerCursor.repo.js';
import { createEventListener } from '../../worker/src/eventListener.js';
import { createReconciler } from '../../worker/src/reconciler.js';
import { createBatchReconciler } from '../../worker/src/batchReconciler.js';

const container = createContainer();
const app = createApp(container);

let inlineWorker = null;
if (container.config.runWorkerInline) {
  const workerCursorRepo = createWorkerCursorRepo({ pool: container.pool });
  const eventListener = createEventListener({
    chainAdapter: container.adapters.chainAdapter,
    certificateRepo: container.certificateRepo,
    txRepo: container.txRepo,
    lifecycleService: container.services.lifecycleService,
    workerCursorRepo,
    logger: container.logger,
    config: container.config,
  });
  const reconciler = createReconciler({
    certificateRepo: container.certificateRepo,
    fileRepo: container.fileRepo,
    txRepo: container.txRepo,
    chainAdapter: container.adapters.chainAdapter,
    lifecycleService: container.services.lifecycleService,
    config: container.config,
    logger: container.logger,
  });
  const batchReconciler = createBatchReconciler({
    batchIssuanceService: container.batchIssuanceService,
    config: container.config,
    logger: container.logger,
  });
  inlineWorker = { eventListener, reconciler, batchReconciler };

  eventListener
    .start()
    .then(() => {
      reconciler.start();
      batchReconciler.start();
      container.logger.info('inline worker started (RUN_WORKER_INLINE=true)');
    })
    .catch((err) => container.logger.error({ err }, 'inline worker failed to start'));
}

const server = app.listen(container.config.port, () => {
  container.logger.info(
    { port: container.config.port, nodeEnv: container.config.nodeEnv, runWorkerInline: container.config.runWorkerInline },
    'SecureCred API listening',
  );
});

const shutdown = (signal) => {
  container.logger.info({ signal }, 'shutting down');
  if (inlineWorker) {
    inlineWorker.reconciler.stop();
    inlineWorker.batchReconciler.stop();
    inlineWorker.eventListener.stop();
  }
  server.close(async (err) => {
    if (err) {
      container.logger.error({ err }, 'error while closing HTTP server');
    }
    try {
      await container.close();
    } catch (closeErr) {
      container.logger.error({ err: closeErr }, 'error while closing pg pool');
    } finally {
      process.exit(err ? 1 : 0);
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
