/**
 * CORS middleware, scoped to the configured allow-list of origins.
 */
import cors from 'cors';

/**
 * Builds the CORS middleware.
 *
 * @param {object} config - Frozen app config (uses corsAllowedOrigins).
 * @returns {import('express').RequestHandler}
 */
export const createCorsMiddleware = (config) =>
  cors({
    origin(origin, callback) {
      // Same-origin / non-browser requests (no Origin header) are always allowed.
      if (!origin || config.corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS policy.`));
    },
    credentials: true,
  });
