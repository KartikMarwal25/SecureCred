/**
 * `/api/v1/institutions` — institution-facing aggregate insight (FR-AUD-003).
 * Deliberately exposes counts only, never a verifier's identity — verification
 * itself is anonymous by design, and this endpoint must not become a way to
 * reconstruct who checked a certificate.
 */
import { Router } from 'express';
import { ROLE } from '@securecred/shared';
import { requireRole } from '../middleware/rbac.mw.js';

/**
 * Builds the `/api/v1/institutions` router.
 *
 * @param {object} deps
 * @param {object} deps.verificationLogRepo
 * @param {import('express').RequestHandler} deps.requireAuth
 * @returns {import('express').Router}
 */
export const createInstitutionsRouter = ({ verificationLogRepo, requireAuth }) => {
  const router = Router();

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
