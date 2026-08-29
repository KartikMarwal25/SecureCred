/**
 * Periodic sweep that rescues certificates stuck in a transient state for
 * longer than `config.stallThresholdSec` — e.g. the process crashed
 * mid-pipeline, a chain call never returned, or an event was missed.
 */
import { CERT_STATE, TRANSACTION_TYPE } from '@securecred/shared';

const MAX_RECONCILE_ATTEMPTS = 5;
const DEFAULT_RECONCILE_INTERVAL_SEC = 60;

/**
 * Creates the reconciler.
 *
 * @param {object} deps
 * @param {object} deps.certificateRepo
 * @param {object} deps.fileRepo - Needed to re-fetch a certificate's pinned CID when retrying a stalled anchor.
 * @param {object} deps.txRepo
 * @param {object} deps.chainAdapter
 * @param {object} deps.lifecycleService
 * @param {object} deps.config - Uses stallThresholdSec, chainNetwork, contractAddress.
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen reconciler: `{ start, stop, sweepOnce }`.
 */
export const createReconciler = ({ certificateRepo, fileRepo, txRepo, chainAdapter, lifecycleService, config, logger }) => {
  const intervalSec = Number(process.env.RECONCILE_INTERVAL_SEC) || DEFAULT_RECONCILE_INTERVAL_SEC;
  let timer = null;

  /**
   * Fails a stalled PENDING_STORAGE certificate — the document was never
   * successfully pinned, so there is nothing to retry.
   *
   * @param {object} cert
   * @returns {Promise<void>}
   */
  const handleStalledStorage = async (cert) => {
    await lifecycleService.transition(cert.certificate_id, CERT_STATE.PENDING_STORAGE, CERT_STATE.FAILED, {
      extra: { failure_cause: 'Storage step stalled without completing (document was never pinned).' },
    });
  };

  /**
   * Retries anchoring a stalled PENDING_ANCHOR certificate (the file is
   * already pinned; only the chain call is retried).
   *
   * @param {object} cert
   * @returns {Promise<void>}
   */
  const handleStalledPendingAnchor = async (cert) => {
    try {
      const files = await fileRepo.findByCertificateId(cert.certificate_id);
      const latestFile = files[files.length - 1];
      if (!latestFile) throw new Error('no pinned file found to anchor');

      const { txHash, nonce } = await chainAdapter.anchor(cert.certificate_hash, latestFile.ipfs_cid, cert.certificate_id);
      await txRepo.insert({
        certificateId: cert.certificate_id,
        transactionHash: txHash,
        transactionType: TRANSACTION_TYPE.ISSUE,
        network: config.chainNetwork,
        contractAddress: config.contractAddress,
        nonce,
      });
      await lifecycleService.transition(cert.certificate_id, CERT_STATE.PENDING_ANCHOR, CERT_STATE.ANCHORING, {});
    } catch (err) {
      const updated = await certificateRepo.bumpReconcileAttempts(cert.certificate_id);
      logger.warn({ err, certificateId: cert.certificate_id, attempts: updated?.reconcile_attempts }, 'reconciler: anchor retry failed');
      if ((updated?.reconcile_attempts ?? 0) >= MAX_RECONCILE_ATTEMPTS) {
        await lifecycleService.transition(cert.certificate_id, CERT_STATE.PENDING_ANCHOR, CERT_STATE.FAILED, {
          extra: { failure_cause: `Anchor retry exhausted after ${MAX_RECONCILE_ATTEMPTS} attempts: ${String(err.message ?? err)}`.slice(0, 500) },
        });
      }
    }
  };

  /**
   * Reconciles a stalled ANCHORING or REVOKING certificate. Queries the
   * contract's own state FIRST, before consulting the local transaction
   * receipt — a fee-bumped resubmission under the same nonce can leave a
   * dangling/failed-looking local receipt even though the certificate was
   * actually confirmed under a replacement transaction; trusting the chain's
   * own truth first avoids misdiagnosing that as a failure.
   *
   * @param {object} cert
   * @param {string} pendingState - CERT_STATE.ANCHORING or CERT_STATE.REVOKING
   * @param {string} targetState - CERT_STATE.ACTIVE or CERT_STATE.REVOKED
   * @param {string} txType - TRANSACTION_TYPE.ISSUE or .REVOKE
   * @param {(facts: object) => boolean} isSettledOnChain - Reads the relevant boolean off chainAdapter.check()'s result.
   * @returns {Promise<void>}
   */
  const handleStalledInFlight = async (cert, pendingState, targetState, txType, isSettledOnChain) => {
    const chainFacts = await chainAdapter.check(cert.certificate_hash);

    if (isSettledOnChain(chainFacts)) {
      // The chain already has the outcome we were waiting for — we just
      // missed (or never received) the confirmation event locally.
      const latestTx = await txRepo.findLatestForCertificate(cert.certificate_id, txType);
      if (latestTx) {
        await txRepo.markConfirmed(latestTx.transaction_hash, latestTx.block_number ?? 0, config.confirmationDepth, null);
      }
      await lifecycleService.transition(cert.certificate_id, pendingState, targetState, {});
      return;
    }

    // Not yet settled on-chain: this is a genuine stall, not a missed event.
    const updated = await certificateRepo.bumpReconcileAttempts(cert.certificate_id);
    if ((updated?.reconcile_attempts ?? 0) >= MAX_RECONCILE_ATTEMPTS) {
      const latestTx = await txRepo.findLatestForCertificate(cert.certificate_id, txType);
      if (latestTx) {
        await txRepo.markFailed(latestTx.transaction_hash, 'Stalled without on-chain confirmation.');
      }
      await lifecycleService.transition(cert.certificate_id, pendingState, CERT_STATE.FAILED, {
        extra: { failure_cause: `Never confirmed on-chain after ${MAX_RECONCILE_ATTEMPTS} reconcile attempts.` },
      });
    }
  };

  /**
   * Dispatches one stalled certificate row to the handler appropriate for
   * its current status.
   *
   * @param {object} cert
   * @returns {Promise<void>}
   */
  const handleStalled = async (cert) => {
    switch (cert.status) {
      case CERT_STATE.PENDING_STORAGE:
        return handleStalledStorage(cert);
      case CERT_STATE.PENDING_ANCHOR:
        return handleStalledPendingAnchor(cert);
      case CERT_STATE.ANCHORING:
        return handleStalledInFlight(cert, CERT_STATE.ANCHORING, CERT_STATE.ACTIVE, TRANSACTION_TYPE.ISSUE, (facts) => facts.isIssued);
      case CERT_STATE.REVOKING:
        return handleStalledInFlight(cert, CERT_STATE.REVOKING, CERT_STATE.REVOKED, TRANSACTION_TYPE.REVOKE, (facts) => facts.isRevoked);
      default:
        logger.warn({ certificateId: cert.certificate_id, status: cert.status }, 'reconciler: unexpected status in stalled sweep');
        return undefined;
    }
  };

  /**
   * Runs one full sweep: finds every stalled certificate and reconciles it.
   * Certificates are independent of one another, so they're processed
   * concurrently via Promise.all rather than one-by-one in a loop.
   *
   * @returns {Promise<void>}
   */
  const sweepOnce = async () => {
    const stalled = await certificateRepo.findStalled(config.stallThresholdSec);
    if (stalled.length === 0) return;
    logger.info({ count: stalled.length }, 'reconciler: sweeping stalled certificates');
    await Promise.all(
      stalled.map((cert) =>
        handleStalled(cert).catch((err) => {
          logger.error({ err, certificateId: cert.certificate_id }, 'reconciler: unhandled error reconciling certificate');
        }),
      ),
    );
  };

  /** Starts the periodic sweep. */
  const start = () => {
    if (timer) return;
    timer = setInterval(() => {
      sweepOnce().catch((err) => logger.error({ err }, 'reconciler: sweep failed'));
    }, intervalSec * 1000);
    timer.unref?.();
    logger.info({ intervalSec }, 'reconciler: started');
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
