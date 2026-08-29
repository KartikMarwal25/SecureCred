/**
 * Subscribes to the registry contract's `CertificateAnchored`/
 * `CertificateRevoked` events, replaying from the last-processed block on
 * startup (via worker_cursor) before switching to a live subscription. Each
 * confirmed event transitions the matching certificate
 * ANCHORING->ACTIVE / REVOKING->REVOKED.
 */
import { CERT_STATE } from '@securecred/shared';

const CURSOR_KEY_PREFIX = 'chain-events';

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
   * Replays past events from the last-saved cursor (or block 0 if never
   * run before) up to "latest", then subscribes live. Idempotent to call
   * once at startup.
   *
   * @returns {Promise<void>}
   */
  const start = async () => {
    contract = chainAdapter.getContractInstance();

    const fromBlock = (await workerCursorRepo.get(cursorKey)) ?? 0;
    const anchoredFilter = contract.filters.CertificateAnchored();
    const revokedFilter = contract.filters.CertificateRevoked();

    const [pastAnchored, pastRevoked] = await Promise.all([
      contract.queryFilter(anchoredFilter, fromBlock, 'latest'),
      contract.queryFilter(revokedFilter, fromBlock, 'latest'),
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

    let latestBlock = fromBlock;
    for (const event of pastEvents) {
      latestBlock = Math.max(latestBlock, event.blockNumber);
    }
    await workerCursorRepo.set(cursorKey, latestBlock);

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
