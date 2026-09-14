/**
 * Authentication middleware: verifies the bearer token via clerk.adapter and
 * attaches `req.auth` from the VERIFIED token only — role/institutionId/
 * userId/studentId are never read from the request body/query/headers.
 *
 * In real (non-dev) Clerk mode, the database — not the JWT's custom claims —
 * is the authoritative source for role/institutionId/studentId. This is
 * deliberate: a self-registered student's institution is only known once an
 * institution actually issues them something (see userRepo.
 * resolveOrCreateStudentForIssuance), and relying on Clerk session-token
 * claims for that would require re-issuing tokens every time it changed.
 *
 * A brand-new signed-up user has NO role until they explicitly choose one
 * via `POST /api/v1/auth/choose-role` (see routes/auth.routes.js) — this
 * middleware does not default them to student on their first request. Until
 * they choose, `req.auth.role`/`userId` are null; `req.auth.clerkUserId` is
 * always set (even then) so the choose-role endpoint has something to work
 * with before any user_account row exists.
 */
import { ERROR_CODE } from '@securecred/shared';
import { AppError } from '../lib/errors.js';

/**
 * Builds the `requireAuth` middleware.
 *
 * @param {object} deps
 * @param {object} deps.clerkAdapter
 * @param {object} deps.userRepo
 * @param {object} deps.config - Frozen app config (uses clerkSecretKey to detect dev mode).
 * @returns {import('express').RequestHandler}
 */
export const createRequireAuth = ({ clerkAdapter, userRepo, config }) => async (req, _res, next) => {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError(ERROR_CODE.E_UNAUTHENTICATED, 'Sign in to continue.');
    }
    const claims = await clerkAdapter.verifyToken(token);

    if (!config?.clerkSecretKey) {
      // Dev-mode bypass: the token itself already encodes the full scope
      // (see clerk.adapter.js's DEV_TOKEN_PATTERN) — trust it as-is, exactly
      // as before, so the seeded demo accounts keep working unchanged.
      req.auth = {
        clerkUserId: claims.userId,
        userId: claims.userId,
        role: claims.role,
        institutionId: claims.institutionId,
        studentId: claims.studentId,
        email: claims.email,
        fullName: claims.fullName ?? null,
      };
      return next();
    }

    // `claims.userId` is Clerk's own subject id (e.g. "user_2abc...") — a
    // completely different id space from this app's `user_account.user_id`
    // (a UUID, used for every FK: certificate.issued_by, revocation.
    // revoked_by, audit_log.user_id, ...). Every lookup below is keyed on
    // clerk_user_id specifically to translate between the two; req.auth.
    // userId is always the resolved INTERNAL uuid, never the raw Clerk id,
    // so downstream code can use it directly as a FK value.
    const account = await userRepo.findByClerkId(claims.userId);
    const scope = account ? await userRepo.findScopeForSubject(account.user_id) : undefined;

    req.auth = {
      clerkUserId: claims.userId,
      userId: account?.user_id ?? null,
      role: scope?.role ?? null,
      institutionId: scope?.institutionId ?? null,
      studentId: scope?.studentId ?? null,
      email: claims.email,
      fullName: claims.fullName ?? null,
    };
    next();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(ERROR_CODE.E_UNAUTHENTICATED, 'Sign in to continue.', { cause: err }));
  }
};
