/**
 * `/api/v1/students` — the student's own view of their certificates. No
 * student id is ever accepted as a route param/query/body — the subject is
 * always taken from the verified auth token (`req.auth.studentId`).
 */
import { Router } from 'express';
import { ROLE, ERROR_CODE } from '@securecred/shared';
import { requireRole } from '../middleware/rbac.mw.js';
import { AppError } from '../lib/errors.js';

/**
 * Builds the `/api/v1/students` router.
 *
 * @param {object} deps
 * @param {object} deps.certificateRepo
 * @param {import('express').RequestHandler} deps.requireAuth
 * @returns {import('express').Router}
 */
export const createStudentsRouter = ({ certificateRepo, requireAuth }) => {
  const router = Router();

  router.get('/me/certificates', requireAuth, requireRole(ROLE.STUDENT), async (req, res, next) => {
    try {
      if (!req.auth.userId) {
        throw new AppError(ERROR_CODE.E_UNAUTHENTICATED, 'Sign in to continue.');
      }
      const items = await certificateRepo.listByHolderUserId(req.auth.userId);
      res.status(200).json({
        status: 'ok',
        items: items.map((cert) => ({
          certificateId: cert.certificate_id,
          certificateNumber: cert.certificate_number,
          title: cert.title,
          certificateType: cert.certificate_type,
          issueDate: cert.issue_date,
          status: cert.status,
          institutionName: cert.institution_name ?? null,
          revocation: cert.revocation_reason
            ? { reason: cert.revocation_reason, revokedAt: cert.revocation_revoked_at }
            : null,
          createdAt: cert.created_at,
          updatedAt: cert.updated_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
