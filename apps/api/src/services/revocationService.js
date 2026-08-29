/**
 * Certificate revocation. There is NO un-revoke code path anywhere in this
 * file or anywhere else in the codebase — do not add one even as a
 * "just in case" (CERT_STATE_TRANSITIONS[REVOKED] is deliberately empty).
 */
import { CERT_STATE, ERROR_CODE, TRANSACTION_TYPE } from '@securecred/shared';
import { AppError } from '../lib/errors.js';

/**
 * Creates the revocation service.
 *
 * @param {object} deps
 * @param {object} deps.certificateRepo
 * @param {object} deps.revocationRepo
 * @param {object} deps.txRepo
 * @param {object} deps.chainAdapter
 * @param {object} deps.lifecycleService
 * @param {object} deps.auditRepo
 * @param {object} deps.config - Frozen app config (uses chainNetwork, contractAddress).
 * @param {(fn: (client: import('pg').PoolClient) => Promise<*>) => Promise<*>} deps.withTransaction - e.g. txHelper.inTransaction bound to the pool.
 * @returns {object} Frozen service: `{ revoke }`.
 */
export const createRevocationService = ({
  certificateRepo,
  revocationRepo,
  txRepo,
  chainAdapter,
  lifecycleService,
  auditRepo,
  config,
  withTransaction,
}) => {
  /**
   * Revokes an ACTIVE certificate. Check order is exact and deliberate:
   * (1) reason bounds, (2) existence, (3) institution ownership, (4) status
   * ACTIVE, (5) on-chain revoke + DB transition, all atomically.
   *
   * @param {string} certificateNumber
   * @param {string} reason
   * @param {{userId: string, institutionId: string}} actor
   * @returns {Promise<{status: string, txHash: string}>}
   * @throws {AppError} E_REASON_REQUIRED, E_NOT_FOUND, E_FORBIDDEN, E_CERT_NOT_ACTIVE.
   */
  const revoke = async (certificateNumber, reason, actor) => {
    const trimmedReason = (reason ?? '').trim();
    if (trimmedReason.length < 10 || trimmedReason.length > 160) {
      throw new AppError(ERROR_CODE.E_REASON_REQUIRED, 'Explain why this credential is being revoked (10-160 characters).');
    }

    const found = await lookupByNumber(certificateNumber);
    if (!found) {
      throw new AppError(ERROR_CODE.E_NOT_FOUND, 'Certificate not found.');
    }

    if (found.institution_id !== actor.institutionId) {
      await auditRepo.append(
        actor.userId,
        'REVOCATION_DENIED_CROSS_INSTITUTION',
        'certificate',
        found.certificate_id,
        { attemptedByInstitution: actor.institutionId, ownerInstitution: found.institution_id },
      );
      throw new AppError(ERROR_CODE.E_FORBIDDEN, 'You do not have permission to revoke this certificate.');
    }

    if (found.status !== CERT_STATE.ACTIVE) {
      throw new AppError(ERROR_CODE.E_CERT_NOT_ACTIVE, 'Only active certificates can be revoked.');
    }

    const { txHash } = await chainAdapter.revoke(found.certificate_hash, trimmedReason);

    await withTransaction(async (client) => {
      const revocation = await revocationRepo.insert(found.certificate_id, actor.userId, trimmedReason, client);
      const transaction = await txRepo.insert(
        {
          certificateId: found.certificate_id,
          transactionHash: txHash,
          transactionType: TRANSACTION_TYPE.REVOKE,
          network: config.chainNetwork,
          contractAddress: config.contractAddress,
        },
        client,
      );
      await revocationRepo.attachTransaction(revocation.revocation_id, transaction.transaction_id, client);
      await lifecycleService.transition(
        found.certificate_id,
        CERT_STATE.ACTIVE,
        CERT_STATE.REVOKING,
        { actorUserId: actor.userId },
        client,
      );
    });

    return { status: CERT_STATE.REVOKING, txHash };
  };

  /** @param {string} certificateNumber @returns {Promise<object|undefined>} */
  const lookupByNumber = (certificateNumber) => certificateRepo.findByCertificateNumber(certificateNumber);

  return Object.freeze({ revoke });
};
