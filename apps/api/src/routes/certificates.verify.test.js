import { describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { VERIFY_OUTCOME } from '@securecred/shared';
import { createApp } from '../app.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

const CERT_NUMBER = 'SKIT-2026-ABCDEFGHJKMN';

const passThrough = (req, res, next) => next();

const makeFakeContainer = (verifyResult, overrides = {}) => ({
  config,
  logger,
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
  provider: null,
  custodianSigner: { address: '0xdead' },
  pinataAdapter: { isAuthOk: jest.fn().mockResolvedValue('dev-mode'), fetchByCid: jest.fn() },
  clerkAdapter: { verifyToken: jest.fn(), verifyWebhook: jest.fn() },
  userRepo: {},
  certificateRepo: {},
  fileRepo: {},
  txRepo: {},
  issuanceService: {},
  verificationService: { verify: jest.fn().mockResolvedValue(verifyResult) },
  revocationService: {},
  requireAuth: passThrough,
  issuanceLimiter: passThrough,
  revocationLimiter: passThrough,
  verifyMinuteLimiter: passThrough,
  verifyHourLimiter: passThrough,
  authLimiter: passThrough,
  ...overrides,
});

describe('GET /api/v1/certificates/verify/:certificateNumber', () => {
  it('responds 200 for VERIFIED', async () => {
    const app = createApp(
      makeFakeContainer({
        outcome: VERIFY_OUTCOME.VERIFIED,
        certificate: { certificate_number: CERT_NUMBER, title: 'B.Tech', certificate_type: 'DEGREE', issue_date: '2026-01-01', status: 'ACTIVE' },
        degraded: false,
        lastConfirmedAt: null,
        revocationReason: null,
      }),
    );
    const response = await request(app).get(`/api/v1/certificates/verify/${CERT_NUMBER}`);
    expect(response.status).toBe(200);
    expect(response.body.outcome).toBe(VERIFY_OUTCOME.VERIFIED);
    expect(response.body.certificate).not.toBeNull();
  });

  it('responds 200 for REVOKED', async () => {
    const app = createApp(
      makeFakeContainer({
        outcome: VERIFY_OUTCOME.REVOKED,
        certificate: { certificate_number: CERT_NUMBER, title: 'B.Tech', certificate_type: 'DEGREE', issue_date: '2026-01-01', status: 'REVOKED' },
        degraded: false,
        lastConfirmedAt: null,
        revocationReason: 'issued in error',
      }),
    );
    const response = await request(app).get(`/api/v1/certificates/verify/${CERT_NUMBER}`);
    expect(response.status).toBe(200);
    expect(response.body.outcome).toBe(VERIFY_OUTCOME.REVOKED);
    expect(response.body.revocationReason).toBe('issued in error');
  });

  it('responds 400 for TAMPERED', async () => {
    const app = createApp(
      makeFakeContainer({
        outcome: VERIFY_OUTCOME.TAMPERED,
        certificate: { certificate_number: CERT_NUMBER },
        degraded: false,
        lastConfirmedAt: null,
        revocationReason: null,
      }),
    );
    const response = await request(app).get(`/api/v1/certificates/verify/${CERT_NUMBER}`);
    expect(response.status).toBe(400);
    expect(response.body.outcome).toBe(VERIFY_OUTCOME.TAMPERED);
    expect(response.body.certificate).toBeNull();
  });

  it('responds 404 for NOT_FOUND', async () => {
    const app = createApp(
      makeFakeContainer({
        outcome: VERIFY_OUTCOME.NOT_FOUND,
        certificate: null,
        degraded: false,
        lastConfirmedAt: null,
        revocationReason: null,
      }),
    );
    const response = await request(app).get(`/api/v1/certificates/verify/${CERT_NUMBER}`);
    expect(response.status).toBe(404);
    expect(response.body.outcome).toBe(VERIFY_OUTCOME.NOT_FOUND);
  });

  it('responds 400 (validation error) for a malformed certificate number, never reaching the service', async () => {
    const container = makeFakeContainer({ outcome: VERIFY_OUTCOME.NOT_FOUND, certificate: null, degraded: false, lastConfirmedAt: null, revocationReason: null });
    const app = createApp(container);
    const response = await request(app).get('/api/v1/certificates/verify/not-a-valid-number');
    expect(response.status).toBe(400);
    expect(container.verificationService.verify).not.toHaveBeenCalled();
  });
});
