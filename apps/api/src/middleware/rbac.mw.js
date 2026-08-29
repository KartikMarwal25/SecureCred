/**
 * Coarse role gating. Resource-level scope (e.g. "this certificate belongs
 * to your institution") is deliberately NOT handled here — it depends on the
 * specific resource being loaded, so it's checked inside the route
 * handler/service instead, where the resource is already in hand.
 */
import { ERROR_CODE } from '@securecred/shared';
import { AppError } from '../lib/errors.js';

/**
 * Builds a middleware that requires `req.auth.role` to equal `role`.
 *
 * @param {string} role - One of ROLE.* from @securecred/shared.
 * @returns {import('express').RequestHandler}
 */
export const requireRole = (role) => (req, _res, next) => {
  if (req.auth?.role !== role) {
    next(new AppError(ERROR_CODE.E_FORBIDDEN, 'You do not have permission to perform this action.'));
    return;
  }
  next();
};
