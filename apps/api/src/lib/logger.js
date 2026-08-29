/**
 * Shared pino logger. Redacts every secret-bearing field so a stray
 * `logger.info(config)` or `logger.error({req}, ...)` can never leak
 * credentials into log aggregation.
 */
import pino from 'pino';
import { config } from './config.js';

/**
 * Application-wide pino logger instance.
 * @type {import('pino').Logger}
 */
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'config.custodianPrivateKey',
      'config.pinataJwt',
      'config.clerkWebhookSecret',
      'config.clerkSecretKey',
      'config.databaseUrl',
      'CUSTODIAN_PRIVATE_KEY',
      'PINATA_JWT',
      'CLERK_WEBHOOK_SECRET',
      'CLERK_SECRET_KEY',
      'DATABASE_URL',
      'req.headers.authorization',
      '*.req.headers.authorization',
      'req.headers.cookie',
      '*.req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});
