/**
 * The ONLY module in the entire codebase permitted to call
 * `certificateRepo.updateStatus` (rule D5). Every certificate status change,
 * anywhere in this system, must go through `transition()` so that legality
 * checks and audit logging can never be bypassed.
 */
import { CERT_STATE_TRANSITIONS, ERROR_CODE } from '@securecred/shared';
import { AppError } from '../lib/errors.js';

/** Thrown when a compare-and-set transition loses a race to a concurrent writer. */
export class ConcurrentTransitionError extends Error {
  constructor(certificateId, from, to) {
    super(`Certificate ${certificateId} was no longer in state ${from} when transitioning to ${to}`);
    this.name = 'ConcurrentTransitionError';
    this.certificateId = certificateId;
    this.from = from;
    this.to = to;
  }
}

/**
 * Creates the lifecycle service.
 *
 * @param {object} deps
 * @param {object} deps.certificateRepo
 * @param {object} deps.auditRepo
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen service: `{ transition }`.
 */
export const createLifecycleService = ({ certificateRepo, auditRepo, logger }) => {
  /**
   * Transitions a certificate from `from` to `to`, iff that edge is legal per
   * `CERT_STATE_TRANSITIONS` and the row is still in `from` at update time.
   *
   * @param {string} certificateId
   * @param {string} from - Required current CERT_STATE.
   * @param {string} to - Target CERT_STATE.
   * @param {object} [ctx] - Extra context for the audit entry / extra columns (see certificate.repo's UPDATABLE_EXTRA_COLUMNS).
   * @param {string|null} [ctx.actorUserId] - Who/what triggered this transition (null for system/worker).
   * @param {object} [ctx.extra] - Extra columns to set alongside status (failure_cause, blockchain_cert_id, etc).
   * @param {import('pg').PoolClient} [dbClient] - Optional transaction client to run the update on.
   * @returns {Promise<object>} The updated certificate row.
   * @throws {AppError} E_ILLEGAL_TRANSITION if `to` is not a legal edge out of `from` (also writes an audit entry first).
   * @throws {ConcurrentTransitionError} If another writer already moved the row out of `from`.
   */
  const transition = async (certificateId, from, to, ctx = {}, dbClient) => {
    const legalEdges = CERT_STATE_TRANSITIONS[from] ?? [];
    if (!legalEdges.includes(to)) {
      await auditRepo.append(
        ctx.actorUserId ?? null,
        'CERTIFICATE_ILLEGAL_TRANSITION',
        'certificate',
        certificateId,
        { from, to, reason: ctx.reason ?? null },
        dbClient,
      );
      logger?.warn?.({ certificateId, from, to }, 'lifecycleService: rejected illegal transition');
      throw new AppError(
        ERROR_CODE.E_ILLEGAL_TRANSITION,
        `Cannot move certificate from ${from} to ${to}.`,
        { context: { certificateId, from, to } },
      );
    }

    const updated = await certificateRepo.updateStatus(certificateId, from, to, ctx.extra ?? {}, dbClient);
    if (!updated) {
      logger?.warn?.({ certificateId, from, to }, 'lifecycleService: lost compare-and-set race');
      throw new ConcurrentTransitionError(certificateId, from, to);
    }

    await auditRepo.append(
      ctx.actorUserId ?? null,
      'CERTIFICATE_STATUS_CHANGED',
      'certificate',
      certificateId,
      { from, to },
      dbClient,
    );

    return updated;
  };

  return Object.freeze({ transition });
};
