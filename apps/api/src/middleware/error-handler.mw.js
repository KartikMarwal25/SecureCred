/**
 * Terminal Express error-handling middleware — must be registered LAST.
 * Maps AppError to its wire shape + status, maps anything else to a generic
 * E_INTERNAL 500 without leaking details, and always logs the full error
 * server-side with the request's correlation id.
 */
import { toWire, AppError } from '../lib/errors.js';

/**
 * Builds the terminal error handler.
 *
 * @param {object} deps
 * @param {import('pino').Logger} deps.logger - Fallback logger if req.log isn't present.
 * @returns {import('express').ErrorRequestHandler}
 */
export const createErrorHandler = ({ logger }) => (err, req, res, _next) => {
  const correlationId = req.id ?? 'unknown';
  const log = req.log ?? logger;
  const status = err instanceof AppError ? err.status : 500;

  log.error({ err, correlationId, path: req.path, method: req.method }, 'request failed');

  res.status(status).json(toWire(err, correlationId));
};
