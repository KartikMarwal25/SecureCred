/**
 * `/api/v1/auth` — "who am I" and the one-time role choice a brand-new
 * signed-up user makes. Role/institutionId/studentId are resolved
 * authoritatively from the DATABASE (see middleware/auth.mw.js), not from
 * Clerk's session-token claims, so the frontend has no other way to learn
 * either fact than asking here.
 */
import { Router } from 'express';
import { ERROR_CODE, ROLE, chooseRoleRequestSchema } from '@securecred/shared';
import { validate } from '../middleware/validate.mw.js';
import { AppError } from '../lib/errors.js';

/**
 * Builds the `/api/v1/auth` router.
 *
 * @param {object} deps
 * @param {import('express').RequestHandler} deps.requireAuth
 * @param {object} deps.userRepo
 * @param {object} deps.institutionRepo
 * @param {object} deps.institutionJoinRequestRepo
 * @returns {import('express').Router}
 */
export const createAuthRouter = ({ requireAuth, userRepo, institutionRepo, institutionJoinRequestRepo }) => {
  const router = Router();

  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      // A signed-in account with no role yet might be mid-way through a join
      // request (see /choose-role below) rather than genuinely brand new —
      // the frontend needs to tell those two states apart, or a returning
      // requester would just be bounced back to the role-choice form. The
      // same is true for a "detached" institution account (role_id stays
      // 'institution' after leaving — see POST /institutions/me/leave —
      // only institution_id clears) that has since submitted a NEW request:
      // role is truthy here, but they're just as much "waiting" as a
      // brand-new signup would be.
      let pendingInstitutionRequest = null;
      const isDetachedInstitution = req.auth.role === ROLE.INSTITUTION && !req.auth.institutionId;
      if (!req.auth.role || isDetachedInstitution) {
        const pending = await institutionJoinRequestRepo.findPendingForClerkUser(req.auth.clerkUserId);
        if (pending) {
          pendingInstitutionRequest = {
            institutionName: pending.institution_name,
            requestedAt: pending.requested_at,
          };
        }
      }

      res.status(200).json({
        status: 'ok',
        userId: req.auth.userId,
        role: req.auth.role,
        institutionId: req.auth.institutionId,
        studentId: req.auth.studentId,
        email: req.auth.email,
        pendingInstitutionRequest,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/choose-role', requireAuth, validate(chooseRoleRequestSchema, 'body'), async (req, res, next) => {
    try {
      // An institution account with no institutionId is "detached" — they
      // left (see POST /institutions/me/leave), most commonly after
      // realizing they created or joined the wrong institution (a typo'd
      // code). That's the one case allowed to run this again, and only to
      // pick an institution — not to switch to student.
      const isDetachedInstitution = req.auth.role === ROLE.INSTITUTION && !req.auth.institutionId;
      if (req.auth.role && !isDetachedInstitution) {
        throw new AppError(ERROR_CODE.E_VALIDATION, "You've already chosen a role for this account.");
      }
      if (isDetachedInstitution && req.body.role !== ROLE.INSTITUTION) {
        throw new AppError(
          ERROR_CODE.E_VALIDATION,
          'You can only choose an institution to rejoin from here.',
        );
      }
      // user_account.email is NOT NULL — fail with a clear, actionable error
      // here rather than letting a raw DB constraint violation surface as an
      // opaque 500 (clerk.adapter.js already tries hard to resolve this from
      // Clerk directly; reaching here means that also failed).
      if (!req.auth.email) {
        throw new AppError(
          ERROR_CODE.E_INTERNAL,
          'Your account email could not be verified. Please sign out and sign in again.',
        );
      }

      const fullName = req.auth.fullName || req.auth.email || 'New user';

      let newInstitutionAccessCode = null;
      let pending = null;

      if (req.body.role === ROLE.STUDENT) {
        await userRepo.provisionOrLinkSelfServiceUser(req.auth.clerkUserId, req.auth.email, fullName);
      } else {
        let institution = await institutionRepo.findByCode(req.body.institutionCode);
        if (!institution) {
          institution = await institutionRepo.create({
            institutionName: req.body.institutionName,
            institutionCode: req.body.institutionCode,
            email: req.auth.email,
          });
          // Only meaningful the moment the institution is created — this is
          // the one time it's ever shown, so the creator can hand it to
          // whoever else at their institution needs to join later.
          newInstitutionAccessCode = institution.access_code;
          // The founding member: nobody exists yet who could approve them,
          // so — and only so — they get instant access, same as before.
          await userRepo.provisionInstitutionSelfService(
            req.auth.clerkUserId,
            req.auth.email,
            fullName,
            institution.institution_id,
          );
        } else {
          if (req.body.accessCode !== institution.access_code) {
            throw new AppError(
              ERROR_CODE.E_FORBIDDEN,
              'Incorrect access code for this institution. Ask your institution admin for the correct code.',
            );
          }
          // Joining an EXISTING institution: the access code only starts a
          // request now. Real access (able to issue, and to permanently
          // revoke — BR-03 makes that irreversible) is granted only once an
          // existing staff member explicitly approves it — see
          // institutions.routes.js's /me/join-requests endpoints.
          const request = await institutionJoinRequestRepo.create({
            institutionId: institution.institution_id,
            clerkUserId: req.auth.clerkUserId,
            email: req.auth.email,
            fullName,
          });
          pending = { institutionName: institution.institution_name, requestedAt: request.requested_at };
        }
      }

      const account = await userRepo.findByClerkId(req.auth.clerkUserId);
      const scope = account ? await userRepo.findScopeForSubject(account.user_id) : undefined;

      res.status(200).json({
        status: 'ok',
        userId: account?.user_id ?? null,
        role: scope?.role ?? null,
        institutionId: scope?.institutionId ?? null,
        studentId: scope?.studentId ?? null,
        ...(newInstitutionAccessCode ? { institutionAccessCode: newInstitutionAccessCode } : {}),
        ...(pending ? { pendingInstitutionRequest: pending } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
