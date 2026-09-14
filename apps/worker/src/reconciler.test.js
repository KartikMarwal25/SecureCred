import { describe, it, expect, jest } from '@jest/globals';
import { CERT_STATE, TRANSACTION_TYPE } from '@securecred/shared';
import { createReconciler } from './reconciler.js';

const fakeLogger = { info: () => {}, warn: () => {}, error: () => {} };
const config = { stallThresholdSec: 120, chainNetwork: 'local', contractAddress: '0xabc', confirmationDepth: 1 };

describe('reconciler per-state decision logic', () => {
  it('fails a stalled PENDING_STORAGE certificate straight to FAILED (never touches the chain)', async () => {
    const transitions = [];
    const chainAdapter = { check: jest.fn(), anchor: jest.fn() };
    const lifecycleService = { transition: async (id, from, to, ctx) => transitions.push({ id, from, to, ctx }) };
    const certificateRepo = {
      findStalled: async () => [{ certificate_id: 'c1', status: CERT_STATE.PENDING_STORAGE, reconcile_attempts: 0 }],
      bumpReconcileAttempts: jest.fn(),
    };
    const reconciler = createReconciler({
      certificateRepo,
      fileRepo: {},
      txRepo: {},
      chainAdapter,
      lifecycleService,
      config,
      logger: fakeLogger,
    });

    await reconciler.sweepOnce();

    expect(chainAdapter.check).not.toHaveBeenCalled();
    expect(transitions).toEqual([
      {
        id: 'c1',
        from: CERT_STATE.PENDING_STORAGE,
        to: CERT_STATE.FAILED,
        ctx: { extra: { failure_cause: expect.stringContaining('never') } },
      },
    ]);
  });

  it('retries the anchor call for a stalled PENDING_ANCHOR certificate using its already-pinned file', async () => {
    const transitions = [];
    const chainAdapter = {
      anchor: jest.fn().mockResolvedValue({ txHash: '0xTX1', nonce: 5 }),
      check: jest.fn().mockResolvedValue({ isIssued: false, isRevoked: false }),
    };
    const lifecycleService = { transition: async (id, from, to) => transitions.push({ id, from, to }) };
    const txInserts = [];
    const certificateRepo = {
      findStalled: async () => [{ certificate_id: 'c2', status: CERT_STATE.PENDING_ANCHOR, certificate_hash: 'h'.repeat(64), reconcile_attempts: 0 }],
      bumpReconcileAttempts: jest.fn(),
    };
    const fileRepo = { findByCertificateId: async () => [{ ipfs_cid: 'devcid-xyz' }] };
    const txRepo = { insert: async (data) => txInserts.push(data) };

    const reconciler = createReconciler({ certificateRepo, fileRepo, txRepo, chainAdapter, lifecycleService, config, logger: fakeLogger });
    await reconciler.sweepOnce();

    expect(chainAdapter.check).toHaveBeenCalledWith('h'.repeat(64));
    expect(chainAdapter.anchor).toHaveBeenCalledWith('h'.repeat(64), 'devcid-xyz', 'c2');
    expect(txInserts).toEqual([
      expect.objectContaining({ certificateId: 'c2', transactionHash: '0xTX1', transactionType: TRANSACTION_TYPE.ISSUE }),
    ]);
    expect(transitions).toEqual([{ id: 'c2', from: CERT_STATE.PENDING_ANCHOR, to: CERT_STATE.ANCHORING }]);
  });

  it('recovers a stalled PENDING_ANCHOR certificate that the chain shows was already anchored, instead of resubmitting it', async () => {
    // A previous anchor() call (from the original request or an earlier
    // sweep) actually succeeded on-chain, but its result never made it back
    // locally. Resubmitting would revert (AlreadyAnchored) and could be
    // mistaken for a genuine failure — checking chain state first avoids that.
    const transitions = [];
    const chainAdapter = { anchor: jest.fn(), check: jest.fn().mockResolvedValue({ isIssued: true, isRevoked: false }) };
    const lifecycleService = { transition: async (id, from, to) => transitions.push({ id, from, to }) };
    const certificateRepo = {
      findStalled: async () => [{ certificate_id: 'c2', status: CERT_STATE.PENDING_ANCHOR, certificate_hash: 'h'.repeat(64), reconcile_attempts: 0 }],
      bumpReconcileAttempts: jest.fn(),
    };
    const fileRepo = { findByCertificateId: jest.fn() };
    const txRepo = { insert: jest.fn() };

    const reconciler = createReconciler({ certificateRepo, fileRepo, txRepo, chainAdapter, lifecycleService, config, logger: fakeLogger });
    await reconciler.sweepOnce();

    expect(chainAdapter.anchor).not.toHaveBeenCalled();
    expect(fileRepo.findByCertificateId).not.toHaveBeenCalled();
    expect(txRepo.insert).not.toHaveBeenCalled();
    expect(transitions).toEqual([{ id: 'c2', from: CERT_STATE.PENDING_ANCHOR, to: CERT_STATE.ACTIVE }]);
  });

  it('for a stalled ANCHORING certificate, queries the contract state BEFORE consulting the local receipt', async () => {
    const callOrder = [];
    const transitions = [];
    const chainAdapter = {
      check: jest.fn(async () => {
        callOrder.push('chain.check');
        return { isIssued: true, isRevoked: false };
      }),
    };
    const txRepo = {
      findLatestForCertificate: jest.fn(async () => {
        callOrder.push('tx.findLatestForCertificate');
        return { transaction_hash: '0xTX2', block_number: 100 };
      }),
      markConfirmed: jest.fn(async () => {
        callOrder.push('tx.markConfirmed');
      }),
    };
    const lifecycleService = { transition: async (id, from, to) => transitions.push({ id, from, to }) };
    const certificateRepo = {
      findStalled: async () => [{ certificate_id: 'c3', status: CERT_STATE.ANCHORING, certificate_hash: 'h'.repeat(64) }],
      bumpReconcileAttempts: jest.fn(),
    };

    const reconciler = createReconciler({ certificateRepo, fileRepo: {}, txRepo, chainAdapter, lifecycleService, config, logger: fakeLogger });
    await reconciler.sweepOnce();

    // The chain check must happen strictly before any local-receipt lookup —
    // a fee-bumped resubmission under the same nonce can otherwise be
    // misdiagnosed as a failure when it actually succeeded on-chain.
    expect(callOrder[0]).toBe('chain.check');
    expect(callOrder).toContain('tx.findLatestForCertificate');
    expect(transitions).toEqual([{ id: 'c3', from: CERT_STATE.ANCHORING, to: CERT_STATE.ACTIVE }]);
  });

  it('for a stalled REVOKING certificate not yet settled on-chain, increments attempts without transitioning until the max is reached', async () => {
    const transitions = [];
    const chainAdapter = { check: jest.fn().mockResolvedValue({ isIssued: true, isRevoked: false }) };
    const lifecycleService = { transition: async (id, from, to, ctx) => transitions.push({ id, from, to, ctx }) };
    const certificateRepo = {
      findStalled: async () => [{ certificate_id: 'c4', status: CERT_STATE.REVOKING, certificate_hash: 'h'.repeat(64), reconcile_attempts: 1 }],
      bumpReconcileAttempts: jest.fn().mockResolvedValue({ reconcile_attempts: 2 }),
    };
    const txRepo = { findLatestForCertificate: jest.fn().mockResolvedValue(null), markFailed: jest.fn() };

    const reconciler = createReconciler({ certificateRepo, fileRepo: {}, txRepo, chainAdapter, lifecycleService, config, logger: fakeLogger });
    await reconciler.sweepOnce();

    // Below the max-attempts threshold: no transition yet, just an attempt bump.
    expect(certificateRepo.bumpReconcileAttempts).toHaveBeenCalledWith('c4');
    expect(transitions).toEqual([]);
  });

  it('gives up to FAILED once a stalled ANCHORING certificate exceeds the max reconcile attempts', async () => {
    const transitions = [];
    const chainAdapter = { check: jest.fn().mockResolvedValue({ isIssued: false, isRevoked: false }) };
    const lifecycleService = { transition: async (id, from, to, ctx) => transitions.push({ id, from, to, ctx }) };
    const certificateRepo = {
      findStalled: async () => [{ certificate_id: 'c5', status: CERT_STATE.ANCHORING, certificate_hash: 'h'.repeat(64), reconcile_attempts: 4 }],
      bumpReconcileAttempts: jest.fn().mockResolvedValue({ reconcile_attempts: 5 }),
    };
    const txRepo = { findLatestForCertificate: jest.fn().mockResolvedValue({ transaction_hash: '0xTX3' }), markFailed: jest.fn() };

    const reconciler = createReconciler({ certificateRepo, fileRepo: {}, txRepo, chainAdapter, lifecycleService, config, logger: fakeLogger });
    await reconciler.sweepOnce();

    expect(txRepo.markFailed).toHaveBeenCalledWith('0xTX3', expect.any(String));
    expect(transitions).toEqual([{ id: 'c5', from: CERT_STATE.ANCHORING, to: CERT_STATE.FAILED, ctx: expect.any(Object) }]);
  });
});
