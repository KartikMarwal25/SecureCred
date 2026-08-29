/**
 * Standard security headers via helmet.
 */
import helmet from 'helmet';

/**
 * Builds the security-headers middleware.
 *
 * @returns {import('express').RequestHandler}
 */
export const createSecurityHeadersMiddleware = () => helmet();
