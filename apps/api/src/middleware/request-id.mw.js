/**
 * Assigns a correlation id to every request, so logs/errors can be tied back
 * to a single client-visible identifier.
 */
import { randomUUID } from 'node:crypto';

/**
 * @returns {import('express').RequestHandler}
 */
export const requestId = () => (req, res, next) => {
  const incoming = req.headers['x-correlation-id'];
  req.id = (typeof incoming === 'string' && incoming.trim()) || randomUUID();
  res.setHeader('X-Correlation-Id', req.id);
  next();
};
