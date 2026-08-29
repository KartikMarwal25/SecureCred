import { describe, it, expect, jest } from '@jest/globals';
import { CERT_STATE } from '@securecred/shared';
import { createEventListener } from './eventListener.js';

const fakeLogger = { info: () => {}, warn: () => {}, error: () => {} };
const config = { chainNetwork: 'local', confirmationDepth: 2 };

describe('eventListener handleAnchored/handleRevoked (pure per-event logic)', () => {
  it('activates a certificate once its anchor tx reaches the required confirmation depth', async () => {
    const transitions = [];
    const marks = [];
    const certificateRepo = { findByHash: jest.fn().mockResolvedValue({ certificate_id: 'c1', status: CERT_STATE.ANCHORING }) };
    const txRepo = { markConfirmed: jest.fn(async (...args) => marks.push(args)) };
    const chainAdapter = { getContractInstance: () => ({}), receiptWithConfirmations: jest.fn().mockResolvedValue({ confirmations: 3 }) };
    const lifecycleService = { transition: async (id, from, to) => transitions.push({ id, from, to }) };
    const workerCursorRepo = { get: jest.fn(), set: jest.fn() };

    const listener = createEventListener({ chainAdapter, certificateRepo, txRepo, lifecycleService, workerCursorRepo, logger: fakeLogger, config });
    await listener.handleAnchored('h'.repeat(64), '0xTX1', 42);

    expect(marks).toEqual([['0xTX1', 42, 3, null]]);
    expect(transitions).toEqual([{ id: 'c1', from: CERT_STATE.ANCHORING, to: CERT_STATE.ACTIVE }]);
  });

  it('does nothing when confirmations are below the required depth', async () => {
    const transitions = [];
    const certificateRepo = { findByHash: jest.fn().mockResolvedValue({ certificate_id: 'c1', status: CERT_STATE.ANCHORING }) };
    const txRepo = { markConfirmed: jest.fn() };
    const chainAdapter = { getContractInstance: () => ({}), receiptWithConfirmations: jest.fn().mockResolvedValue({ confirmations: 1 }) };
    const lifecycleService = { transition: async (id, from, to) => transitions.push({ id, from, to }) };
    const workerCursorRepo = { get: jest.fn(), set: jest.fn() };

    const listener = createEventListener({ chainAdapter, certificateRepo, txRepo, lifecycleService, workerCursorRepo, logger: fakeLogger, config });
    await listener.handleAnchored('h'.repeat(64), '0xTX1', 42);

    expect(txRepo.markConfirmed).not.toHaveBeenCalled();
    expect(transitions).toEqual([]);
  });

  it('logs a warning and does nothing for an unknown certificate hash', async () => {
    const warn = jest.fn();
    const certificateRepo = { findByHash: jest.fn().mockResolvedValue(undefined) };
    const txRepo = { markConfirmed: jest.fn() };
    const chainAdapter = { getContractInstance: () => ({}), receiptWithConfirmations: jest.fn() };
    const lifecycleService = { transition: jest.fn() };
    const workerCursorRepo = { get: jest.fn(), set: jest.fn() };

    const listener = createEventListener({
      chainAdapter,
      certificateRepo,
      txRepo,
      lifecycleService,
      workerCursorRepo,
      logger: { ...fakeLogger, warn },
      config,
    });
    await listener.handleAnchored('unknown-hash', '0xTX1', 42);

    expect(warn).toHaveBeenCalled();
    expect(chainAdapter.receiptWithConfirmations).not.toHaveBeenCalled();
    expect(lifecycleService.transition).not.toHaveBeenCalled();
  });

  it('revokes a certificate once its revoke tx reaches the required confirmation depth', async () => {
    const transitions = [];
    const certificateRepo = { findByHash: jest.fn().mockResolvedValue({ certificate_id: 'c2', status: CERT_STATE.REVOKING }) };
    const txRepo = { markConfirmed: jest.fn().mockResolvedValue(undefined) };
    const chainAdapter = { getContractInstance: () => ({}), receiptWithConfirmations: jest.fn().mockResolvedValue({ confirmations: 5 }) };
    const lifecycleService = { transition: async (id, from, to) => transitions.push({ id, from, to }) };
    const workerCursorRepo = { get: jest.fn(), set: jest.fn() };

    const listener = createEventListener({ chainAdapter, certificateRepo, txRepo, lifecycleService, workerCursorRepo, logger: fakeLogger, config });
    await listener.handleRevoked('h'.repeat(64), '0xTX2', 100);

    expect(transitions).toEqual([{ id: 'c2', from: CERT_STATE.REVOKING, to: CERT_STATE.REVOKED }]);
  });

  it('ignores an anchor event for a certificate no longer in ANCHORING (already processed)', async () => {
    const certificateRepo = { findByHash: jest.fn().mockResolvedValue({ certificate_id: 'c3', status: CERT_STATE.ACTIVE }) };
    const txRepo = { markConfirmed: jest.fn() };
    const chainAdapter = { getContractInstance: () => ({}), receiptWithConfirmations: jest.fn() };
    const lifecycleService = { transition: jest.fn() };
    const workerCursorRepo = { get: jest.fn(), set: jest.fn() };

    const listener = createEventListener({ chainAdapter, certificateRepo, txRepo, lifecycleService, workerCursorRepo, logger: fakeLogger, config });
    await listener.handleAnchored('h'.repeat(64), '0xTX1', 42);

    expect(chainAdapter.receiptWithConfirmations).not.toHaveBeenCalled();
    expect(lifecycleService.transition).not.toHaveBeenCalled();
  });
});
