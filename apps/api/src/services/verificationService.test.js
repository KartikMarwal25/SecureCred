import { describe, it, expect, jest } from '@jest/globals';
import { VERIFY_OUTCOME, CERT_STATE, VERIFICATION_METHOD } from '@securecred/shared';
import { decideOutcome, createVerificationService } from './verificationService.js';

describe('decideOutcome (pure) — release-gating precedence rule', () => {
  // All 2x2x2 boolean combinations of {isIssued, hashMatchesOnChain, isRevoked}.
  const cases = [
    { isIssued: false, hashMatchesOnChain: false, isRevoked: false, expected: VERIFY_OUTCOME.NOT_FOUND },
    { isIssued: false, hashMatchesOnChain: false, isRevoked: true, expected: VERIFY_OUTCOME.NOT_FOUND },
    { isIssued: false, hashMatchesOnChain: true, isRevoked: false, expected: VERIFY_OUTCOME.NOT_FOUND },
    { isIssued: false, hashMatchesOnChain: true, isRevoked: true, expected: VERIFY_OUTCOME.NOT_FOUND },
    { isIssued: true, hashMatchesOnChain: false, isRevoked: false, expected: VERIFY_OUTCOME.TAMPERED },
    { isIssued: true, hashMatchesOnChain: false, isRevoked: true, expected: VERIFY_OUTCOME.TAMPERED },
    { isIssued: true, hashMatchesOnChain: true, isRevoked: false, expected: VERIFY_OUTCOME.VERIFIED },
    { isIssued: true, hashMatchesOnChain: true, isRevoked: true, expected: VERIFY_OUTCOME.REVOKED },
  ];

  it.each(cases)(
    'isIssued=$isIssued hashMatchesOnChain=$hashMatchesOnChain isRevoked=$isRevoked -> $expected',
    ({ isIssued, hashMatchesOnChain, isRevoked, expected }) => {
      expect(decideOutcome({ isIssued, hashMatchesOnChain, isRevoked })).toBe(expected);
    },
  );

  it('never returns VERIFIED when hashMatchesOnChain is false, regardless of isRevoked', () => {
    for (const isRevoked of [true, false]) {
      const outcome = decideOutcome({ isIssued: true, hashMatchesOnChain: false, isRevoked });
      expect(outcome).not.toBe(VERIFY_OUTCOME.VERIFIED);
      expect(outcome).toBe(VERIFY_OUTCOME.TAMPERED);
    }
  });
});

describe('createVerificationService.verify (orchestration, substitute dependencies)', () => {
  const makeService = (overrides = {}) => {
    const certificate = {
      certificate_id: 'cert-1',
      certificate_number: 'SKIT-2026-ABCDEFGHJKMN',
      status: CERT_STATE.ACTIVE,
      certificate_hash: 'a'.repeat(64),
      last_confirmed_chain_state: null,
      last_chain_check_at: null,
    };

    const certificateRepo = {
      findByCertificateNumber: jest.fn().mockResolvedValue(certificate),
      recordChainState: jest.fn().mockResolvedValue(undefined),
      ...overrides.certificateRepo,
    };
    const chainAdapter = {
      check: jest.fn().mockResolvedValue({ isIssued: true, isRevoked: false, ipfsCid: 'devcid-abc', revocationReason: '' }),
      ...overrides.chainAdapter,
    };
    const pinataAdapter = {
      fetchByCid: jest.fn().mockResolvedValue(Buffer.from('genuine document bytes')),
      ...overrides.pinataAdapter,
    };
    const verificationLogRepo = {
      append: jest.fn().mockResolvedValue(undefined),
      ...overrides.verificationLogRepo,
    };
    const hashLib = {
      sha256Hex: jest.fn().mockReturnValue('a'.repeat(64)),
      fingerprintsEqual: jest.fn((a, b) => a === b),
      ...overrides.hashLib,
    };
    const logger = { warn: jest.fn(), info: jest.fn() };

    const service = createVerificationService({ certificateRepo, chainAdapter, pinataAdapter, verificationLogRepo, hashLib, logger });
    return { service, certificateRepo, chainAdapter, pinataAdapter, verificationLogRepo, hashLib, certificate };
  };

  it('returns VERIFIED when issued, not revoked, and the fetched document hash matches', async () => {
    const { service, verificationLogRepo } = makeService();
    const result = await service.verify('SKIT-2026-ABCDEFGHJKMN', VERIFICATION_METHOD.CERT_ID);
    expect(result.outcome).toBe(VERIFY_OUTCOME.VERIFIED);
    expect(result.degraded).toBe(false);
    expect(verificationLogRepo.append).toHaveBeenCalledWith('cert-1', null, VERIFICATION_METHOD.CERT_ID, VERIFY_OUTCOME.VERIFIED, false);
  });

  it('returns REVOKED when issued, revoked, and the hash still matches', async () => {
    const { service } = makeService({
      chainAdapter: { check: jest.fn().mockResolvedValue({ isIssued: true, isRevoked: true, ipfsCid: 'devcid-abc', revocationReason: 'issued in error' }) },
    });
    const result = await service.verify('SKIT-2026-ABCDEFGHJKMN', VERIFICATION_METHOD.CERT_ID);
    expect(result.outcome).toBe(VERIFY_OUTCOME.REVOKED);
    expect(result.revocationReason).toBe('issued in error');
  });

  it('returns TAMPERED when the fetched document hash does not match the stored fingerprint', async () => {
    const { service } = makeService({
      hashLib: { sha256Hex: jest.fn().mockReturnValue('b'.repeat(64)), fingerprintsEqual: jest.fn(() => false) },
    });
    const result = await service.verify('SKIT-2026-ABCDEFGHJKMN', VERIFICATION_METHOD.CERT_ID);
    expect(result.outcome).toBe(VERIFY_OUTCOME.TAMPERED);
  });

  it('upload path: VERIFIED when the uploaded document hashes to the stored fingerprint, and pinataAdapter is never called', async () => {
    const { service, pinataAdapter, hashLib } = makeService({
      hashLib: {
        sha256Hex: jest.fn((buf) => (buf.toString() === 'genuine' ? 'a'.repeat(64) : 'b'.repeat(64))),
        fingerprintsEqual: jest.fn((a, b) => a === b),
      },
    });
    const result = await service.verify(
      'SKIT-2026-ABCDEFGHJKMN',
      VERIFICATION_METHOD.HASH,
      null,
      Buffer.from('genuine'),
    );
    expect(result.outcome).toBe(VERIFY_OUTCOME.VERIFIED);
    // The whole point of the upload path: never fetch from IPFS at all —
    // the verifier's own bytes are hashed directly.
    expect(pinataAdapter.fetchByCid).not.toHaveBeenCalled();
    expect(hashLib.sha256Hex).toHaveBeenCalledWith(Buffer.from('genuine'));
  });

  it('upload path: TAMPERED when the uploaded document does NOT hash to the stored fingerprint (the actual tamper-detection demo)', async () => {
    const { service, pinataAdapter } = makeService({
      hashLib: {
        sha256Hex: jest.fn().mockReturnValue('different-hash-entirely'.padEnd(64, '0')),
        fingerprintsEqual: jest.fn(() => false),
      },
    });
    const result = await service.verify(
      'SKIT-2026-ABCDEFGHJKMN',
      VERIFICATION_METHOD.HASH,
      null,
      Buffer.from('edited CGPA to 9.72'),
    );
    expect(result.outcome).toBe(VERIFY_OUTCOME.TAMPERED);
    expect(pinataAdapter.fetchByCid).not.toHaveBeenCalled();
  });

  it('upload path: REVOKED still takes precedence over a matching upload hash', async () => {
    const { service } = makeService({
      chainAdapter: { check: jest.fn().mockResolvedValue({ isIssued: true, isRevoked: true, ipfsCid: 'devcid-abc', revocationReason: 'issued in error' }) },
      hashLib: { sha256Hex: jest.fn().mockReturnValue('a'.repeat(64)), fingerprintsEqual: jest.fn(() => true) },
    });
    const result = await service.verify('SKIT-2026-ABCDEFGHJKMN', VERIFICATION_METHOD.HASH, null, Buffer.from('genuine'));
    expect(result.outcome).toBe(VERIFY_OUTCOME.REVOKED);
  });

  it('upload path: NOT_FOUND for an unknown certificate number, uploaded buffer or not', async () => {
    const { service, chainAdapter } = makeService({ certificateRepo: { findByCertificateNumber: jest.fn().mockResolvedValue(undefined) } });
    const result = await service.verify('SKIT-2026-NOPE00000000', VERIFICATION_METHOD.HASH, null, Buffer.from('anything'));
    expect(result.outcome).toBe(VERIFY_OUTCOME.NOT_FOUND);
    expect(chainAdapter.check).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND without ever calling the chain when no row exists', async () => {
    const { service, chainAdapter } = makeService({ certificateRepo: { findByCertificateNumber: jest.fn().mockResolvedValue(undefined) } });
    const result = await service.verify('SKIT-2026-NOPE00000000', VERIFICATION_METHOD.CERT_ID);
    expect(result.outcome).toBe(VERIFY_OUTCOME.NOT_FOUND);
    expect(chainAdapter.check).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a row in a non-public state, without calling the chain', async () => {
    const { service, chainAdapter } = makeService({
      certificateRepo: { findByCertificateNumber: jest.fn().mockResolvedValue({ certificate_id: 'cert-2', status: CERT_STATE.PENDING_ANCHOR }) },
    });
    const result = await service.verify('SKIT-2026-ABCDEFGHJKMN', VERIFICATION_METHOD.CERT_ID);
    expect(result.outcome).toBe(VERIFY_OUTCOME.NOT_FOUND);
    expect(chainAdapter.check).not.toHaveBeenCalled();
  });

  it('falls back to last_confirmed_chain_state, degraded, when the live chain call fails', async () => {
    const { service } = makeService({
      chainAdapter: { check: jest.fn().mockRejectedValue(new Error('RPC down')) },
      certificateRepo: {
        findByCertificateNumber: jest.fn().mockResolvedValue({
          certificate_id: 'cert-1',
          status: CERT_STATE.ACTIVE,
          certificate_hash: 'a'.repeat(64),
          last_confirmed_chain_state: { isIssued: true, isRevoked: false, ipfsCid: 'devcid-abc' },
          last_chain_check_at: '2026-01-01T00:00:00.000Z',
        }),
      },
    });
    const result = await service.verify('SKIT-2026-ABCDEFGHJKMN', VERIFICATION_METHOD.CERT_ID);
    expect(result.degraded).toBe(true);
    expect(result.outcome).toBe(VERIFY_OUTCOME.VERIFIED);
    expect(result.lastConfirmedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns degraded NOT_FOUND when the chain call fails and nothing was ever confirmed', async () => {
    const { service } = makeService({
      chainAdapter: { check: jest.fn().mockRejectedValue(new Error('RPC down')) },
      certificateRepo: {
        findByCertificateNumber: jest.fn().mockResolvedValue({
          certificate_id: 'cert-1',
          status: CERT_STATE.ACTIVE,
          certificate_hash: 'a'.repeat(64),
          last_confirmed_chain_state: null,
        }),
      },
    });
    const result = await service.verify('SKIT-2026-ABCDEFGHJKMN', VERIFICATION_METHOD.CERT_ID);
    expect(result.outcome).toBe(VERIFY_OUTCOME.NOT_FOUND);
    expect(result.degraded).toBe(true);
  });
});
