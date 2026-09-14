import { describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

/**
 * Builds a fully substituted container — no real Postgres/Clerk/Pinata/chain
 * required — so app.js's routing/middleware wiring can be exercised in
 * isolation.
 */
const makeFakeContainer = (overrides = {}) => ({
  config,
  logger,
  pool: { query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) },
  provider: null,
  custodianSigner: { address: '0x000000000000000000000000000000000000dEaD' },
  pinataAdapter: { isAuthOk: jest.fn().mockResolvedValue('dev-mode'), fetchByCid: jest.fn() },
  clerkAdapter: { verifyToken: jest.fn(), verifyWebhook: jest.fn() },
  userRepo: {},
  certificateRepo: {},
  fileRepo: {},
  txRepo: {},
  issuanceService: {},
  verificationService: {},
  revocationService: {},
  requireAuth: (req, res, next) => next(),
  issuanceLimiter: (req, res, next) => next(),
  revocationLimiter: (req, res, next) => next(),
  verifyMinuteLimiter: (req, res, next) => next(),
  verifyHourLimiter: (req, res, next) => next(),
  authLimiter: (req, res, next) => next(),
  ...overrides,
});

describe('GET /api/v1/health', () => {
  it('reports ok with dependency statuses when everything is reachable / dev-mode', async () => {
    const app = createApp(makeFakeContainer());
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      dependencies: { postgres: 'ok', pinata: 'dev-mode', rpc: 'unconfigured' },
      custodian: { address: '0x000000000000000000000000000000000000dEaD' },
    });
    expect(response.body.version).toEqual(expect.any(String));
  });

  it('returns 503 when Postgres is down', async () => {
    const app = createApp(
      makeFakeContainer({
        pool: { query: jest.fn().mockRejectedValue(new Error('connection refused')) },
      }),
    );
    const response = await request(app).get('/api/v1/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.postgres).toBe('down');
  });
});
