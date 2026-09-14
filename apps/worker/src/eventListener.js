/**
 * Subscribes to the registry contract's `CertificateAnchored`/
 * `CertificateRevoked` events, replaying from the last-processed block on
 * startup (via worker_cursor) before switching to a live subscription. Each
 * confirmed event transitions the matching certificate
 * ANCHORING->ACTIVE / REVOKING->REVOKED.
 */
import { CERT_STATE } from '@securecred/shared';

const CURSOR_KEY_PREFIX = 'chain-events';

// Conservative default: comfortably under the 10,000-block cap several
// public RPC providers enforce on eth_getLogs (confirmed directly against
// Polygon Amoy's public RPC — a single unchunked queryFilter over the
// worker's very first replay window returned a 403 "exceed maximum block
// range: 10000" and crashed the whole worker on every boot, since nothing
// ever advanced the cursor past that failure).
const MAX_BLOCK_RANGE = 5000;

// Bounds a first-ever boot's replay window (no saved cursor yet) to a
// recent slice of chain history, instead of the full span back to the
// contract's deployment block. Confirmed necessary directly against Amoy's
// public RPC: it prunes eth_getLogs history far more aggressively than its
// stated 10,000-block range cap suggests (windows even a few hundred
// thousand blocks old — nowhere near genesis — came back "History has been
// pruned for this block"), so a deployment that's weeks old turned a first
// boot into hundreds of doomed-to-fail request/skip cycles before ever
// reaching the live subscription. Once a real cursor exists, THAT is always
// honored exactly (never capped) — this bound only applies to the unknown,
// unbounded-by-default starting point of a brand-new worker. Anything older
// than this window that's still genuinely stuck is the reconciler's job
// (reconciler.js), which reads the contract's current state directly and
// needs no event history at all.
const MAX_FIRST_BOOT_LOOKBACK_BLOCKS = 20000;

/**
 * Runs `contract.queryFilter(filter, ...)` in windows no wider than
 * MAX_BLOCK_RANGE and concatenates the results, so a from/to span far wider
 * than a provider's own per-call limit never fails outright.
 *
 * A single window can still fail even at this size — a non-archive public
 * RPC node prunes logs older than its own retention window and rejects any
 * query touching that range ("history has been pruned for this block"),
 * confirmed directly against Polygon Amoy's public RPC. That's expected,
 * not fatal: this is only a best-effort backfill. A certificate whose
 * anchor/revoke event falls in a skipped window is still recoverable —
 * reconciler.js's stalled-in-flight sweep reads the contract's CURRENT
 * state directly (checkCertificate), not historical logs, so it needs no
 * event history at all to eventually confirm it. So a failed window is
 * logged and skipped, never allowed to crash the whole worker boot the way
 * it used to.
 *
 * @param {import('ethers').Contract} contract
 * @param {import('ethers').DeferredTopicFilter} filter
 * @param {number} fromBlock
 * @param {number} toBlock
 * @param {import('pino').Logger} logger
 * @returns {Promise<import('ethers').EventLog[]>}
 */
const queryFilterChunked = async (contract, filter, fromBlock, toBlock, logger) => {
  const results = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_BLOCK_RANGE) {
    const end = Math.min(start + MAX_BLOCK_RANGE - 1, toBlock);
    try {
      // Windows are queried in order, not in parallel — firing them
      // concurrently would multiply the in-flight request rate against the
      // very provider whose per-call range limit caused this chunking to
      // be necessary in the first place, risking a rate-limit failure
      // instead.
      const chunk = await contract.queryFilter(filter, start, end);
      results.push(...chunk);
    } catch (err) {
      logger?.warn?.(
        { err, fromBlock: start, toBlock: end },
        'eventListener: could not replay this block range (likely pruned on this RPC node) — skipping it; the reconciler will still catch any certificate stuck in this window',
      );
    }
  }
  return results;
};

/**
 * Normalizes a contract event's bytes32 `certificateHash` topic (0x-prefixed,
 * 66 chars) into this codebase's stored hash format (64-char hex, no prefix).
 *
 * @param {string} bytes32Hash
 * @returns {string}
 */
const toStoredHash = (bytes32Hash) => bytes32Hash.replace(/^0x/, '').toLowerCase();

/**
 * Creates the on-chain event listener.
 *
 * @param {object} deps
 * @param {object} deps.chainAdapter
 * @param {object} deps.certificateRepo
 * @param {object} deps.txRepo
 * @param {object} deps.lifecycleService
 * @param {object} deps.workerCursorRepo
 * @param {import('pino').Logger} deps.logger
 * @param {object} deps.config - Uses chainNetwork, confirmationDepth.
 * @returns {object} Frozen listener: `{ start, stop }`.
 */
export const createEventListener = ({ chainAdapter, certificateRepo, txRepo, lifecycleService, workerCursorRepo, logger, config }) => {
  const cursorKey = `${CURSOR_KEY_PREFIX}:${config.chainNetwork}`;
  let contract = null;
  let anchoredHandler = null;
  let revokedHandler = null;

  /**
   * Processes one anchor confirmation: if the certificate is still
   * ANCHORING and the transaction has reached the required confirmation
   * depth, marks the tx CONFIRMED and transitions the certificate to ACTIVE.
   * Logs and does nothing if the hash doesn't match any known certificate.
   *
   * @param {string} certificateHashHex
   * @param {string} txHash
   * @param {number} blockNumber
   * @returns {Promise<void>}
   */
  const handleAnchored = async (certificateHashHex, txHash, blockNumber) => {
    const certificate = await certificateRepo.findByHash(certificateHashHex);
    if (!certificate) {
      logger.warn({ certificateHashHex, txHash }, 'eventListener: CertificateAnchored for an unknown certificate hash');
      return;
    }
    if (certificate.status !== CERT_STATE.ANCHORING) {
      return; // already processed, or not in a state we expect an anchor event for
    }

    const { confirmations } = await chainAdapter.receiptWithConfirmations(txHash);
    if (confirmations < config.confirmationDepth) {
      return; // reconciler will pick this up once it stalls, or a later event/poll will re-check
    }

    await txRepo.markConfirmed(txHash, blockNumber, confirmations, null);
    await lifecycleService.transition(certificate.certificate_id, CERT_STATE.ANCHORING, CERT_STATE.ACTIVE, {
      actorUserId: null,
    });
    logger.info({ certificateId: certificate.certificate_id, txHash }, 'eventListener: certificate activated');
  };

  /**
   * Processes one revocation confirmation, mirroring `handleAnchored`.
   *
   * @param {string} certificateHashHex
   * @param {string} txHash
   * @param {number} blockNumber
   * @returns {Promise<void>}
   */
  const handleRevoked = async (certificateHashHex, txHash, blockNumber) => {
    const certificate = await certificateRepo.findByHash(certificateHashHex);
    if (!certificate) {
      logger.warn({ certificateHashHex, txHash }, 'eventListener: CertificateRevoked for an unknown certificate hash');
      return;
    }
    if (certificate.status !== CERT_STATE.REVOKING) {
      return;
    }

    const { confirmations } = await chainAdapter.receiptWithConfirmations(txHash);
    if (confirmations < config.confirmationDepth) {
      return;
    }

    await txRepo.markConfirmed(txHash, blockNumber, confirmations, null);
    await lifecycleService.transition(certificate.certificate_id, CERT_STATE.REVOKING, CERT_STATE.REVOKED, {
      actorUserId: null,
    });
    logger.info({ certificateId: certificate.certificate_id, txHash }, 'eventListener: certificate revoked (confirmed)');
  };

  /**
   * Replays past events from the last-saved cursor (or a bounded recent
   * window if never run before) up to "latest", then subscribes live.
   * Idempotent to call once at startup.
   *
   * @returns {Promise<void>}
   */
  const start = async () => {
    contract = chainAdapter.getContractInstance();

    const savedCursor = await workerCursorRepo.get(cursorKey);
    const toBlock = await chainAdapter.getBlockNumber();
    // A saved cursor is always honored exactly — real progress is never
    // capped. Only a first-ever boot (no cursor yet) gets bounded to a
    // recent window: no CertificateAnchored event can exist before the
    // contract's own deployment block, and MAX_FIRST_BOOT_LOOKBACK_BLOCKS
    // keeps that first replay fast and bounded even when the deployment is
    // old (see its own comment for why that matters here specifically).
    const fromBlock =
      savedCursor ?? Math.max(chainAdapter.getDeploymentBlock() ?? 0, toBlock - MAX_FIRST_BOOT_LOOKBACK_BLOCKS);
    const anchoredFilter = contract.filters.CertificateAnchored();
    const revokedFilter = contract.filters.CertificateRevoked();

    const [pastAnchored, pastRevoked] =
      fromBlock > toBlock
        ? [[], []]
        : await Promise.all([
            queryFilterChunked(contract, anchoredFilter, fromBlock, toBlock, logger),
            queryFilterChunked(contract, revokedFilter, fromBlock, toBlock, logger),
          ]);

    const pastEvents = [...pastAnchored, ...pastRevoked].sort((a, b) => a.blockNumber - b.blockNumber);

    await pastEvents.reduce(
      (chain, event) =>
        chain.then(async () => {
          if (event.fragment?.name === 'CertificateRevoked' || event.eventName === 'CertificateRevoked') {
            await handleRevoked(toStoredHash(event.args.certificateHash), event.transactionHash, event.blockNumber);
          } else {
            await handleAnchored(toStoredHash(event.args.certificateHash), event.transactionHash, event.blockNumber);
          }
        }),
      Promise.resolve(),
    );

    // Advances to toBlock regardless of whether any events were found —
    // we've now confirmed there's nothing to miss up to that point, so
    // re-scanning the same (already-empty) range on every future restart
    // would be pure waste, not extra safety.
    await workerCursorRepo.set(cursorKey, Math.max(fromBlock, toBlock));

    anchoredHandler = async (certificateHash, issuer, ipfsCid, timestamp, certificateRef, event) => {
      try {
        await handleAnchored(toStoredHash(certificateHash), event.log.transactionHash, event.log.blockNumber);
        await workerCursorRepo.set(cursorKey, event.log.blockNumber);
      } catch (err) {
        logger.error({ err }, 'eventListener: failed to process live CertificateAnchored event');
      }
    };
    revokedHandler = async (certificateHash, issuer, reason, timestamp, event) => {
      try {
        await handleRevoked(toStoredHash(certificateHash), event.log.transactionHash, event.log.blockNumber);
        await workerCursorRepo.set(cursorKey, event.log.blockNumber);
      } catch (err) {
        logger.error({ err }, 'eventListener: failed to process live CertificateRevoked event');
      }
    };

    contract.on('CertificateAnchored', anchoredHandler);
    contract.on('CertificateRevoked', revokedHandler);
    logger.info({ fromBlock, cursorKey }, 'eventListener: subscribed to chain events');
  };

  /** Unsubscribes from live events. */
  const stop = () => {
    if (contract) {
      if (anchoredHandler) contract.off('CertificateAnchored', anchoredHandler);
      if (revokedHandler) contract.off('CertificateRevoked', revokedHandler);
    }
  };

  return Object.freeze({ start, stop, handleAnchored, handleRevoked });
};
