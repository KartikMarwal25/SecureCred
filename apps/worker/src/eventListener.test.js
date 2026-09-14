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

describe('eventListener.start() (replay window, chunking, and cursor advancement)', () => {
  const makeFakeContract = ({ queryFilterImpl } = {}) => {
    const anchoredFilter = { name: 'CertificateAnchored' };
    const revokedFilter = { name: 'CertificateRevoked' };
    return {
      filters: {
        CertificateAnchored: () => anchoredFilter,
        CertificateRevoked: () => revokedFilter,
      },
      queryFilter: jest.fn(queryFilterImpl ?? (async () => [])),
      on: jest.fn(),
      off: jest.fn(),
    };
  };

  const baseDeps = () => ({
    certificateRepo: { findByHash: jest.fn() },
    txRepo: { markConfirmed: jest.fn() },
    lifecycleService: { transition: jest.fn() },
    logger: fakeLogger,
    config,
  });

  it('uses the contract deployment block as the replay floor when no cursor was ever saved — never block 0', async () => {
    const contract = makeFakeContract();
    const chainAdapter = {
      getContractInstance: () => contract,
      getBlockNumber: jest.fn().mockResolvedValue(1000),
      getDeploymentBlock: jest.fn().mockReturnValue(900),
    };
    const workerCursorRepo = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const listener = createEventListener({ chainAdapter, workerCursorRepo, ...baseDeps() });

    await listener.start();

    expect(contract.queryFilter).toHaveBeenCalledWith(expect.anything(), 900, 1000);
    expect(workerCursorRepo.set).toHaveBeenCalledWith(expect.any(String), 1000);
  });

  it('prefers a saved cursor over the deployment block once one exists', async () => {
    const contract = makeFakeContract();
    const chainAdapter = {
      getContractInstance: () => contract,
      getBlockNumber: jest.fn().mockResolvedValue(1000),
      getDeploymentBlock: jest.fn().mockReturnValue(900),
    };
    const workerCursorRepo = { get: jest.fn().mockResolvedValue(950), set: jest.fn() };
    const listener = createEventListener({ chainAdapter, workerCursorRepo, ...baseDeps() });

    await listener.start();

    expect(contract.queryFilter).toHaveBeenCalledWith(expect.anything(), 950, 1000);
  });

  it('bounds a first-ever boot to a recent window instead of the full span back to an old deployment block', async () => {
    // Regression test for a third real production failure: on a deployment
    // several weeks old, replaying the FULL span back to the deployment
    // block turned a first boot into hundreds of sequential pruned-range
    // warnings (see the pruned-window test below) before it could ever
    // reach the live subscription. The deployment block is still a correct
    // floor — just not one worth walking all the way back to on an unknown
    // first boot; a saved cursor (tested above) is never capped this way.
    const contract = makeFakeContract();
    const chainAdapter = {
      getContractInstance: () => contract,
      getBlockNumber: jest.fn().mockResolvedValue(1000000),
      getDeploymentBlock: jest.fn().mockReturnValue(1), // an old, near-genesis deployment
    };
    const workerCursorRepo = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const listener = createEventListener({ chainAdapter, workerCursorRepo, ...baseDeps() });

    await listener.start();

    // Bounded to MAX_FIRST_BOOT_LOOKBACK_BLOCKS (20000) before the chain
    // head, not all the way back to block 1.
    const anchoredCalls = contract.queryFilter.mock.calls.filter(([f]) => f.name === 'CertificateAnchored');
    expect(anchoredCalls[0][1]).toBe(1000000 - 20000);
  });

  it('chunks a range wider than the per-call limit into multiple queryFilter calls', async () => {
    const contract = makeFakeContract();
    const chainAdapter = {
      getContractInstance: () => contract,
      getBlockNumber: jest.fn().mockResolvedValue(12000),
      getDeploymentBlock: jest.fn().mockReturnValue(0),
    };
    const workerCursorRepo = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const listener = createEventListener({ chainAdapter, workerCursorRepo, ...baseDeps() });

    await listener.start();

    const anchoredCalls = contract.queryFilter.mock.calls.filter(([f]) => f.name === 'CertificateAnchored');
    expect(anchoredCalls.map(([, from, to]) => [from, to])).toEqual([
      [0, 4999],
      [5000, 9999],
      [10000, 12000],
    ]);
  });

  it('replays a wide first-boot range in chunks without ever exceeding a provider range cap — the exact bug this guards against', async () => {
    // Regression test for a real production failure: the worker crashed on
    // every boot with "server response 403 Forbidden ... exceed maximum
    // block range: 10000" because the original code queried the ENTIRE
    // from/to span in one call. This fake fails any call wider than 10000
    // blocks, exactly mirroring that provider's behavior.
    const contract = makeFakeContract({
      queryFilterImpl: async (filter, from, to) => {
        if (to - from + 1 > 10000) {
          throw new Error('server response 403 Forbidden ... exceed maximum block range: 10000');
        }
        return [];
      },
    });
    const chainAdapter = {
      getContractInstance: () => contract,
      getBlockNumber: jest.fn().mockResolvedValue(50000),
      getDeploymentBlock: jest.fn().mockReturnValue(0),
    };
    const workerCursorRepo = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const listener = createEventListener({ chainAdapter, workerCursorRepo, ...baseDeps() });

    await expect(listener.start()).resolves.toBeUndefined();
  });

  it('skips a window a non-archive RPC node has pruned instead of crashing the whole boot, and still queries the windows around it', async () => {
    // A second real production failure hit right after the range-cap fix
    // above: chunking alone doesn't help when the provider has simply
    // discarded logs for an old block range ("History has been pruned for
    // this block") — that fails at ANY chunk size. Confirmed directly
    // against Polygon Amoy's public RPC for a window near the contract's
    // deployment block.
    const prunedWindowLog = { blockNumber: 500, transactionHash: '0xpruned-adjacent', fragment: { name: 'CertificateAnchored' }, eventName: 'CertificateAnchored', args: { certificateHash: `0x${'b'.repeat(64)}` } };
    const contract = makeFakeContract({
      queryFilterImpl: async (filter, from) => {
        if (from === 0) throw new Error('History has been pruned for this block.');
        if (filter.name === 'CertificateAnchored' && from === 5000) return [prunedWindowLog];
        return [];
      },
    });
    const chainAdapter = {
      getContractInstance: () => contract,
      getBlockNumber: jest.fn().mockResolvedValue(12000),
      getDeploymentBlock: jest.fn().mockReturnValue(0),
      receiptWithConfirmations: jest.fn().mockResolvedValue({ confirmations: 5 }),
    };
    const workerCursorRepo = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const certificateRepo = { findByHash: jest.fn().mockResolvedValue({ certificate_id: 'c1', status: CERT_STATE.ANCHORING }) };
    const transitions = [];
    const lifecycleService = { transition: async (id, from, to) => transitions.push({ id, from, to }) };
    const warn = jest.fn();

    const listener = createEventListener({
      chainAdapter,
      workerCursorRepo,
      certificateRepo,
      txRepo: { markConfirmed: jest.fn() },
      lifecycleService,
      logger: { ...fakeLogger, warn },
      config,
    });

    await expect(listener.start()).resolves.toBeUndefined();
    // The event in the window AFTER the pruned one must still be found and processed.
    expect(transitions).toEqual([{ id: 'c1', from: CERT_STATE.ANCHORING, to: CERT_STATE.ACTIVE }]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 0 }),
      expect.stringContaining('pruned'),
    );
  });

  it('advances the cursor to the current chain head even when no events were found, so an empty range is never rescanned on the next boot', async () => {
    const contract = makeFakeContract();
    const chainAdapter = {
      getContractInstance: () => contract,
      getBlockNumber: jest.fn().mockResolvedValue(2000),
      getDeploymentBlock: jest.fn().mockReturnValue(1000),
    };
    const workerCursorRepo = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const listener = createEventListener({ chainAdapter, workerCursorRepo, ...baseDeps() });

    await listener.start();

    expect(workerCursorRepo.set).toHaveBeenCalledWith(expect.any(String), 2000);
  });

  it('skips querying entirely when the saved cursor is already past the chain head (e.g. a lagging RPC node)', async () => {
    const contract = makeFakeContract();
    const chainAdapter = {
      getContractInstance: () => contract,
      getBlockNumber: jest.fn().mockResolvedValue(1000),
      getDeploymentBlock: jest.fn().mockReturnValue(0),
    };
    const workerCursorRepo = { get: jest.fn().mockResolvedValue(1001), set: jest.fn() };
    const listener = createEventListener({ chainAdapter, workerCursorRepo, ...baseDeps() });

    await listener.start();

    expect(contract.queryFilter).not.toHaveBeenCalled();
  });

  it('processes a past event found during replay and still subscribes for live events afterward', async () => {
    const eventLog = {
      blockNumber: 950,
      transactionHash: '0xabc',
      fragment: { name: 'CertificateAnchored' },
      eventName: 'CertificateAnchored',
      args: { certificateHash: `0x${'a'.repeat(64)}` },
    };
    const contract = makeFakeContract({
      queryFilterImpl: async (filter) => (filter.name === 'CertificateAnchored' ? [eventLog] : []),
    });
    const chainAdapter = {
      getContractInstance: () => contract,
      getBlockNumber: jest.fn().mockResolvedValue(1000),
      getDeploymentBlock: jest.fn().mockReturnValue(900),
      receiptWithConfirmations: jest.fn().mockResolvedValue({ confirmations: 3 }),
    };
    const workerCursorRepo = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    const certificateRepo = { findByHash: jest.fn().mockResolvedValue({ certificate_id: 'c1', status: CERT_STATE.ANCHORING }) };
    const transitions = [];
    const lifecycleService = { transition: async (id, from, to) => transitions.push({ id, from, to }) };
    const txRepo = { markConfirmed: jest.fn() };

    const listener = createEventListener({
      chainAdapter,
      workerCursorRepo,
      certificateRepo,
      txRepo,
      lifecycleService,
      logger: fakeLogger,
      config,
    });
    await listener.start();

    expect(transitions).toEqual([{ id: 'c1', from: CERT_STATE.ANCHORING, to: CERT_STATE.ACTIVE }]);
    expect(contract.on).toHaveBeenCalledWith('CertificateAnchored', expect.any(Function));
    expect(contract.on).toHaveBeenCalledWith('CertificateRevoked', expect.any(Function));
  });
});
