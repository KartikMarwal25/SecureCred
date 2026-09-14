/**
 * `/api/v1/institutions` — institution-facing aggregate insight (FR-AUD-003)
 * plus one small public route. Deliberately exposes counts only, never a
 * verifier's identity — verification itself is anonymous by design, and
 * this endpoint must not become a way to reconstruct who checked a
 * certificate.
 */
import { Router } from 'express';
import { ROLE, ERROR_CODE, joinRequestIdParamSchema } from '@securecred/shared';
import { requireRole } from '../middleware/rbac.mw.js';
import { validate } from '../middleware/validate.mw.js';
import { AppError } from '../lib/errors.js';
import { getGasStatusSummary } from '../lib/gasStatus.js';

/**
 * Builds the `/api/v1/institutions` router.
 *
 * @param {object} deps
 * @param {object} deps.verificationLogRepo
 * @param {object} deps.institutionRepo
 * @param {object} deps.institutionJoinRequestRepo
 * @param {object} deps.userRepo
 * @param {object} deps.auditRepo
 * @param {object} deps.chainAdapter
 * @param {import('express').RequestHandler} deps.requireAuth
 * @returns {import('express').Router}
 */
export const createInstitutionsRouter = ({
  verificationLogRepo,
  institutionRepo,
  institutionJoinRequestRepo,
  userRepo,
  auditRepo,
  chainAdapter,
  requireAuth,
}) => {
  const router = Router();

  // Public, unauthenticated — feeds the landing page's "real registered
  // issuer" card. Institution-level aggregate only (name + a count), never
  // a specific certificate or its holder — see the module comment.
  router.get('/showcase', async (req, res, next) => {
    try {
      const showcase = await institutionRepo.findShowcase();
      res.status(200).json({
        status: 'ok',
        institutionName: showcase?.institutionName ?? null,
        certificateCount: showcase?.certificateCount ?? 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth, requireRole(ROLE.INSTITUTION), async (req, res, next) => {
    try {
      const institution = await institutionRepo.findById(req.auth.institutionId);
      if (!institution) {
        throw new AppError(ERROR_CODE.E_NOT_FOUND, 'Your institution could not be found.');
      }
      res.status(200).json({
        status: 'ok',
        institutionName: institution.institution_name,
        institutionCode: institution.institution_code,
      });
    } catch (err) {
      next(err);
    }
  });

  // The custodian wallet is shared across every institution (one backend-
  // held signer anchors everyone's certificates — see custodianSigner.js),
  // so this isn't institution-specific data; it's exposed here because
  // "can I issue certificates right now" is exactly what an institution
  // admin needs to know, and the platform's own gas reserve is what that
  // depends on. Never exposes the private key or wallet address's full
  // transaction history — balance and a status label only.
  router.get('/me/gas-status', requireAuth, requireRole(ROLE.INSTITUTION), async (req, res, next) => {
    try {
      const balanceWei = await chainAdapter.getCustodianBalance();
      res.status(200).json({ status: 'ok', ...getGasStatusSummary(balanceWei) });
    } catch (err) {
      next(err);
    }
  });

  // Self-service fix for "typed the wrong institution code" — detaches the
  // caller from their institution (their account and any certificates they
  // already issued/revoked are untouched) so they can go back through
  // /choose-role and pick the right one. See userRepo.leaveInstitution and
  // auth.routes.js's /choose-role guard for the other half of this.
  router.post('/me/leave', requireAuth, requireRole(ROLE.INSTITUTION), async (req, res, next) => {
    try {
      await userRepo.leaveInstitution(req.auth.userId);
      await auditRepo.append(req.auth.userId, 'INSTITUTION_LEFT', 'institution', req.auth.institutionId, {});
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/me/rotate-access-code',
    requireAuth,
    requireRole(ROLE.INSTITUTION),
    async (req, res, next) => {
      try {
        const newCode = await institutionRepo.rotateAccessCode(req.auth.institutionId);
        await auditRepo.append(req.auth.userId, 'INSTITUTION_ACCESS_CODE_ROTATED', 'institution', req.auth.institutionId, {});
        res.status(200).json({ status: 'ok', accessCode: newCode });
      } catch (err) {
        next(err);
      }
    },
  );

  // Every staff member of the institution can see and decide requests —
  // there's no separate admin tier in this schema (same trust level as
  // issuing/revoking, which any staff member can already do). See
  // migration 015 / auth.routes.js for why requests exist at all: the
  // access code alone no longer grants instant access.
  router.get('/me/join-requests', requireAuth, requireRole(ROLE.INSTITUTION), async (req, res, next) => {
    try {
      const requests = await institutionJoinRequestRepo.findPendingForInstitution(req.auth.institutionId);
      res.status(200).json({
        status: 'ok',
        items: requests.map((r) => ({
          requestId: r.request_id,
          fullName: r.full_name,
          email: r.email,
          requestedAt: r.requested_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/me/join-requests/:requestId/approve',
    requireAuth,
    requireRole(ROLE.INSTITUTION),
    validate(joinRequestIdParamSchema, 'params'),
    async (req, res, next) => {
      try {
        const request = await institutionJoinRequestRepo.findById(req.params.requestId);
        if (!request || request.institution_id !== req.auth.institutionId) {
          throw new AppError(ERROR_CODE.E_NOT_FOUND, 'This request could not be found.');
        }
        const decided = await institutionJoinRequestRepo.decide(req.params.requestId, 'APPROVED', req.auth.userId);
        if (!decided) {
          throw new AppError(ERROR_CODE.E_VALIDATION, 'This request has already been decided.');
        }
        await userRepo.provisionInstitutionSelfService(
          decided.clerk_user_id,
          decided.email,
          decided.full_name,
          req.auth.institutionId,
        );
        await auditRepo.append(
          req.auth.userId,
          'INSTITUTION_JOIN_REQUEST_APPROVED',
          'institution_join_request',
          decided.request_id,
          { email: decided.email },
        );
        res.status(200).json({ status: 'ok' });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/me/join-requests/:requestId/reject',
    requireAuth,
    requireRole(ROLE.INSTITUTION),
    validate(joinRequestIdParamSchema, 'params'),
    async (req, res, next) => {
      try {
        const request = await institutionJoinRequestRepo.findById(req.params.requestId);
        if (!request || request.institution_id !== req.auth.institutionId) {
          throw new AppError(ERROR_CODE.E_NOT_FOUND, 'This request could not be found.');
        }
        const decided = await institutionJoinRequestRepo.decide(req.params.requestId, 'REJECTED', req.auth.userId);
        if (!decided) {
          throw new AppError(ERROR_CODE.E_VALIDATION, 'This request has already been decided.');
        }
        await auditRepo.append(
          req.auth.userId,
          'INSTITUTION_JOIN_REQUEST_REJECTED',
          'institution_join_request',
          decided.request_id,
          { email: decided.email },
        );
        res.status(200).json({ status: 'ok' });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/me/activity', requireAuth, requireRole(ROLE.INSTITUTION), async (req, res, next) => {
    try {
      const institutionId = req.auth.institutionId;
      const [seriesByDay, mostVerified, outcomeDistribution] = await Promise.all([
        verificationLogRepo.seriesByDayForInstitution(institutionId, 30),
        verificationLogRepo.mostVerifiedForInstitution(institutionId, 5),
        verificationLogRepo.aggregateForInstitution(institutionId),
      ]);

      res.status(200).json({
        status: 'ok',
        seriesByDay,
        mostVerified,
        outcomeDistribution: outcomeDistribution.map((row) => ({
          outcome: row.result,
          count: row.count,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
