/**
 * Authentication middleware: verifies the bearer token via clerk.adapter and
 * attaches `req.auth` from the VERIFIED token only — role/institutionId/
 * userId/studentId are never read from the request body/query/headers.
 */
import { ERROR_CODE } from '@securecred/shared';
import { AppError } from '../lib/errors.js';

/**
 * Builds the `requireAuth` middleware.
 *
 * @param {object} deps
 * @param {object} deps.clerkAdapter
 * @returns {import('express').RequestHandler}
 */
export const createRequireAuth = ({ clerkAdapter }) => async (req, _res, next) => {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError(ERROR_CODE.E_UNAUTHENTICATED, 'Sign in to continue.');
    }
    const claims = await clerkAdapter.verifyToken(token);
    req.auth = {
      userId: claims.userId,
      role: claims.role,
      institutionId: claims.institutionId,
      studentId: claims.studentId,
    };
    next();
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(ERROR_CODE.E_UNAUTHENTICATED, 'Sign in to continue.', { cause: err }));
  }
};
