import { describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import { VERIFY_OUTCOME, VERIFICATION_METHOD } from '@securecred/shared';
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
  batchIssuanceService: {},
  requireAuth: passThrough,
  issuanceLimiter: passThrough,
  revocationLimiter: passThrough,
  verifyMinuteLimiter: passThrough,
  verifyHourLimiter: passThrough,
  authLimiter: passThrough,
  ...overrides,
});

describe('POST /api/v1/certificates/verify-upload/:certificateNumber', () => {
  it('responds 200 VERIFIED and forwards the uploaded bytes + HASH method to verificationService', async () => {
    const container = makeFakeContainer({
      outcome: VERIFY_OUTCOME.VERIFIED,
      certificate: { certificate_number: CERT_NUMBER, title: 'B.Tech', certificate_type: 'DEGREE', issue_date: '2026-01-01', status: 'ACTIVE' },
      degraded: false,
      lastConfirmedAt: null,
      revocationReason: null,
      certificateHash: 'a'.repeat(64),
      ipfsCid: 'devcid-abc',
      txHash: '0xabc',
    });
    const app = createApp(container);
    const response = await request(app)
      .post(`/api/v1/certificates/verify-upload/${CERT_NUMBER}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('genuine document bytes'));

    expect(response.status).toBe(200);
    expect(response.body.outcome).toBe(VERIFY_OUTCOME.VERIFIED);
    expect(response.body.certificate).not.toBeNull();
    expect(container.verificationService.verify).toHaveBeenCalledWith(
      CERT_NUMBER,
      VERIFICATION_METHOD.HASH,
      null,
      expect.any(Buffer),
    );
    const forwardedBuffer = container.verificationService.verify.mock.calls[0][3];
    expect(forwardedBuffer.toString()).toBe('genuine document bytes');
  });

  it('responds 400 TAMPERED when the uploaded document does not match (the actual tamper-detection demo)', async () => {
    const container = makeFakeContainer({
      outcome: VERIFY_OUTCOME.TAMPERED,
      certificate: { certificate_number: CERT_NUMBER },
      degraded: false,
      lastConfirmedAt: null,
      revocationReason: null,
    });
    const app = createApp(container);
    const response = await request(app)
      .post(`/api/v1/certificates/verify-upload/${CERT_NUMBER}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('edited CGPA to 9.72'));

    expect(response.status).toBe(400);
    expect(response.body.outcome).toBe(VERIFY_OUTCOME.TAMPERED);
    expect(response.body.certificate).toBeNull();
  });

  it('responds 404 NOT_FOUND for an unknown certificate number', async () => {
    const container = makeFakeContainer({
      outcome: VERIFY_OUTCOME.NOT_FOUND,
      certificate: null,
      degraded: false,
      lastConfirmedAt: null,
      revocationReason: null,
    });
    const app = createApp(container);
    const response = await request(app)
      .post('/api/v1/certificates/verify-upload/SKIT-2026-ZZZZZZZZZZZZ')
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('anything'));

    expect(response.status).toBe(404);
    expect(response.body.outcome).toBe(VERIFY_OUTCOME.NOT_FOUND);
  });

  it('responds 400 without ever calling the service when no PDF body is sent', async () => {
    const container = makeFakeContainer({ outcome: VERIFY_OUTCOME.NOT_FOUND, certificate: null, degraded: false, lastConfirmedAt: null, revocationReason: null });
    const app = createApp(container);
    const response = await request(app)
      .post(`/api/v1/certificates/verify-upload/${CERT_NUMBER}`)
      .set('Content-Type', 'application/pdf');

    expect(response.status).toBe(400);
    expect(container.verificationService.verify).not.toHaveBeenCalled();
  });

  it('responds 400 (validation error) for a malformed certificate number, never reaching the service', async () => {
    const container = makeFakeContainer({ outcome: VERIFY_OUTCOME.NOT_FOUND, certificate: null, degraded: false, lastConfirmedAt: null, revocationReason: null });
    const app = createApp(container);
    const response = await request(app)
      .post('/api/v1/certificates/verify-upload/not-a-valid-number')
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('anything'));

    expect(response.status).toBe(400);
    expect(container.verificationService.verify).not.toHaveBeenCalled();
  });
});
