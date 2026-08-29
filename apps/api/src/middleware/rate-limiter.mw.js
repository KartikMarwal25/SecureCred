/**
 * A simple in-memory fixed-window rate limiter — no Redis dependency, so it
 * only offers per-process limits (fine for this project's single-instance
 * deployment target). Routes that need two simultaneous windows (e.g. verify:
 * 30/min AND 600/hr) simply stack two limiter instances as consecutive
 * middleware.
 */
import { ERROR_CODE } from '@securecred/shared';
import { AppError } from '../lib/errors.js';

/**
 * Creates a fixed-window rate-limiting middleware.
 *
 * @param {object} opts
 * @param {number} opts.windowMs - Window length in milliseconds.
 * @param {number} opts.max - Max requests allowed per key per window.
 * @param {(req: import('express').Request) => string} opts.keyFn - Derives the bucket key from the request (e.g. IP, or institutionId).
 * @returns {import('express').RequestHandler}
 */
export const createRateLimiter = ({ windowMs, max, keyFn }) => {
  /** @type {Map<string, {count: number, windowStart: number}>} */
  const buckets = new Map();

  return (req, _res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || now - existing.windowStart >= windowMs) {
      buckets.set(key, { count: 1, windowStart: now });
      next();
      return;
    }

    if (existing.count >= max) {
      next(new AppError(ERROR_CODE.E_RATE_LIMITED, 'Too many requests. Please try again shortly.'));
      return;
    }

    existing.count += 1;
    next();
  };
};

/** Default key function: rate-limit by client IP. */
export const byIp = (req) => req.ip ?? req.socket?.remoteAddress ?? 'unknown';

/** Key function for authenticated institutional routes: rate-limit per institution. */
export const byInstitution = (req) => req.auth?.institutionId ?? byIp(req);
