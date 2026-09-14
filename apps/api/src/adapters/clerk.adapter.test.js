import { describe, it, expect, jest } from '@jest/globals';
import { createClerkAdapter } from './clerk.adapter.js';

const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe('createClerkAdapter — production fail-closed guard', () => {
  it('throws at construction if NODE_ENV=production and CLERK_SECRET_KEY is missing', () => {
    expect(() =>
      createClerkAdapter({ config: { nodeEnv: 'production', clerkSecretKey: '', clerkWebhookSecret: 'whsec_x' }, logger }),
    ).toThrow(/CLERK_SECRET_KEY required in production/);
  });

  it('throws at construction if NODE_ENV=production and CLERK_WEBHOOK_SECRET is missing', () => {
    expect(() =>
      createClerkAdapter({ config: { nodeEnv: 'production', clerkSecretKey: 'sk_live_x', clerkWebhookSecret: '' }, logger }),
    ).toThrow(/CLERK_WEBHOOK_SECRET required in production/);
  });

  it('names both missing secrets when both are unset in production', () => {
    expect(() => createClerkAdapter({ config: { nodeEnv: 'production', clerkSecretKey: '', clerkWebhookSecret: '' }, logger })).toThrow(
      /CLERK_SECRET_KEY and CLERK_WEBHOOK_SECRET required in production/,
    );
  });

  it('does NOT throw in production when both secrets are set', () => {
    expect(() =>
      createClerkAdapter({ config: { nodeEnv: 'production', clerkSecretKey: 'sk_live_x', clerkWebhookSecret: 'whsec_x' }, logger }),
    ).not.toThrow();
  });

  it('does NOT throw outside production even with both secrets unset (dev-bypass is intentional there)', () => {
    expect(() =>
      createClerkAdapter({ config: { nodeEnv: 'development', clerkSecretKey: '', clerkWebhookSecret: '' }, logger }),
    ).not.toThrow();
  });
});

describe('createClerkAdapter — dev-bypass behavior (development only)', () => {
  const devConfig = { nodeEnv: 'development', clerkSecretKey: '', clerkWebhookSecret: '' };

  it('verifyToken accepts a well-formed dev token', async () => {
    const adapter = createClerkAdapter({ config: devConfig, logger });
    const claims = await adapter.verifyToken('dev:institution:inst-1:user-1:admin@example.com');
    expect(claims).toMatchObject({ userId: 'user-1', role: 'institution', institutionId: 'inst-1', email: 'admin@example.com' });
  });

  it('verifyToken rejects a malformed dev token', async () => {
    const adapter = createClerkAdapter({ config: devConfig, logger });
    await expect(adapter.verifyToken('not-a-dev-token')).rejects.toThrow();
  });

  it('verifyToken rejects an unknown role in a dev token', async () => {
    const adapter = createClerkAdapter({ config: devConfig, logger });
    await expect(adapter.verifyToken('dev:superadmin:inst-1:user-1:x@example.com')).rejects.toThrow();
  });

  it('verifyWebhook parses the raw body as JSON without signature verification', () => {
    const adapter = createClerkAdapter({ config: devConfig, logger });
    const payload = adapter.verifyWebhook(Buffer.from(JSON.stringify({ type: 'user.created' })), {});
    expect(payload).toEqual({ type: 'user.created' });
  });
});
