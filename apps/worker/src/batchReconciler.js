/**
 * Periodic sweep that resumes batch-issuance jobs abandoned mid-run — the
 * API process that was driving one crashed, redeployed, or lost its
 * connection before every row reached a terminal status. Mirrors
 * reconciler.js's role for the certificate pipeline, one level up: instead
 * of resuming a single stalled chain call, this resumes a whole job from
 * its still-PENDING rows.
 */
const DEFAULT_RECONCILE_INTERVAL_SEC = 60;

/**
 * Creates the batch reconciler.
 *
 * @param {object} deps
 * @param {object} deps.batchIssuanceService - Uses resumeStalledBatches(thresholdSec).
 * @param {object} deps.config - Uses stallThresholdSec.
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen reconciler: `{ start, stop, sweepOnce }`.
 */
export const createBatchReconciler = ({ batchIssuanceService, config, logger }) => {
  const intervalSec = Number(process.env.RECONCILE_INTERVAL_SEC) || DEFAULT_RECONCILE_INTERVAL_SEC;
  let timer = null;

  /** Runs one full sweep: resumes every stalled batch job. */
  const sweepOnce = async () => {
    const { resumedJobs } = await batchIssuanceService.resumeStalledBatches(config.stallThresholdSec);
    if (resumedJobs > 0) {
      logger.info({ resumedJobs }, 'batchReconciler: resumed stalled batch jobs');
    }
  };

  /** Starts the periodic sweep. */
  const start = () => {
    if (timer) return;
    timer = setInterval(() => {
      sweepOnce().catch((err) => logger.error({ err }, 'batchReconciler: sweep failed'));
    }, intervalSec * 1000);
    timer.unref?.();
    logger.info({ intervalSec }, 'batchReconciler: started');
  };

  /** Stops the periodic sweep. */
  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return Object.freeze({ start, stop, sweepOnce });
};
