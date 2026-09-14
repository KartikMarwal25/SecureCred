import { describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { VERIFY_OUTCOME, ROLE } from '@securecred/shared';
import { createApp } from '../app.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { createRateLimiter, byIp } from '../middleware/rate-limiter.mw.js';

/**
 * Proves two real security fixes actually take effect through the full
 * app — not just that a parameter is passed, but that a second request
 * genuinely gets rate-limited. Both endpoints had zero rate limiting before
 * this: GET /:certificateNumber/document (public, does a real external
 * Pinata fetch per request) and POST /auth/choose-role (validates an
 * institution access code and can create institution rows) — the latter's
 * authLimiter existed in container.js but was never wired to any route.
 */
const CERT_NUMBER = 'SKIT-2026-ABCDEFGHJKMN';
const passThrough = (req, res, next) => next();
// max: 1 so the SECOND request in the same window is the one that proves
// the limiter is live — waiting for a real window to expire isn't needed.
const strictLimiter = () => createRateLimiter({ windowMs: 60_000, max: 1, keyFn: byIp });

const makeFakeContainer = (overrides = {}) => ({
  config,
  logger,
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
  provider: null,
  custodianSigner: { address: '0xdead' },
  pinataAdapter: { isAuthOk: jest.fn().mockResolvedValue('dev-mode'), fetchByCid: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')) },
  clerkAdapter: { verifyToken: jest.fn(), verifyWebhook: jest.fn() },
  userRepo: {},
  certificateRepo: {},
  fileRepo: { findByCertificateId: jest.fn().mockResolvedValue([{ ipfs_cid: 'devcid-abc' }]) },
  txRepo: {},
  issuanceService: {},
  verificationService: {
    verify: jest.fn().mockResolvedValue({
      outcome: VERIFY_OUTCOME.VERIFIED,
      certificate: { certificate_id: 'cert-1', certificate_number: CERT_NUMBER },
    }),
  },
  revocationService: {},
  batchIssuanceService: {},
  requireAuth: passThrough,
  issuanceLimiter: passThrough,
  revocationLimiter: passThrough,
  verifyMinuteLimiter: passThrough,
  verifyHourLimiter: passThrough,
  authLimiter: passThrough,
  ...overrides,
});

describe('GET /api/v1/certificates/:certificateNumber/document — now rate-limited', () => {
  it('the second request in the same window is rejected with 429', async () => {
    const app = createApp(makeFakeContainer({ verifyMinuteLimiter: strictLimiter() }));

    const first = await request(app).get(`/api/v1/certificates/${CERT_NUMBER}/document`);
    expect(first.status).toBe(200);

    const second = await request(app).get(`/api/v1/certificates/${CERT_NUMBER}/document`);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('E_RATE_LIMITED');
  });
});

describe('POST /api/v1/auth/choose-role — authLimiter now actually wired', () => {
  const fakeAuthRequireAuth = (req, _res, next) => {
    req.auth = { userId: null, role: null, institutionId: null, studentId: null, email: 'x@example.com', fullName: 'X', clerkUserId: 'clerk-1' };
    next();
  };

  it('the second request in the same window is rejected with 429', async () => {
    const app = createApp(
      makeFakeContainer({
        requireAuth: fakeAuthRequireAuth,
        authLimiter: strictLimiter(),
        userRepo: { provisionOrLinkSelfServiceUser: jest.fn().mockResolvedValue(undefined), findByClerkId: jest.fn().mockResolvedValue(undefined) },
      }),
    );

    const body = { role: ROLE.STUDENT };
    const first = await request(app).post('/api/v1/auth/choose-role').send(body);
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/v1/auth/choose-role').send(body);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe('E_RATE_LIMITED');
  });
});
