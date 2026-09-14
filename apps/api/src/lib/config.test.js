import { describe, it, expect, jest, afterEach } from '@jest/globals';

/**
 * Regression test for a real bug found and fixed directly: `z.coerce.
 * boolean()` on a string env var runs JS's own `Boolean(value)` coercion,
 * and `Boolean("false")` is `true` — any non-empty string is truthy. This
 * silently made `DATABASE_SSL=false` in `.env` resolve to
 * `config.databaseSsl === true`, discovered only by actually connecting a
 * pool to a non-SSL Postgres and watching it fail with "The server does
 * not support SSL connections." `booleanEnv` (config.js) is the fix; this
 * test is what stops it from regressing back to `z.coerce.boolean()`.
 *
 * config.js reads `process.env` once, at import time, so each case sets
 * the env vars it needs and dynamically re-imports the module fresh.
 */
describe('config.js — boolean env parsing', () => {
  afterEach(() => {
    jest.resetModules();
    delete process.env.DATABASE_SSL;
    delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  });

  it('DATABASE_SSL=false resolves to false (the actual bug: z.coerce.boolean() got this wrong)', async () => {
    process.env.DATABASE_SSL = 'false';
    const { config } = await import('./config.js');
    expect(config.databaseSsl).toBe(false);
  });

  it('DATABASE_SSL=true resolves to true', async () => {
    process.env.DATABASE_SSL = 'true';
    const { config } = await import('./config.js');
    expect(config.databaseSsl).toBe(true);
  });

  it('DATABASE_SSL unset defaults to false', async () => {
    const { config } = await import('./config.js');
    expect(config.databaseSsl).toBe(false);
  });

  it('DATABASE_SSL_REJECT_UNAUTHORIZED=false resolves to false (same bug class)', async () => {
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'false';
    const { config } = await import('./config.js');
    expect(config.databaseSslRejectUnauthorized).toBe(false);
  });

  it('DATABASE_SSL_REJECT_UNAUTHORIZED unset defaults to true', async () => {
    const { config } = await import('./config.js');
    expect(config.databaseSslRejectUnauthorized).toBe(true);
  });
});
