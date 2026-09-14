import { describe, it, expect, jest } from '@jest/globals';
import { CERT_STATE, ERROR_CODE, TRANSACTION_TYPE } from '@securecred/shared';
import { createIssuanceService } from './issuanceService.js';

const baseInput = () => ({
  holderName: 'Asha Verma',
  holderEmail: 'asha@example.com',
  enrollmentNumber: 'ENR-001',
  title: 'Bachelor of Technology',
  certificateType: 'DEGREE',
  course: 'Computer Science & Engineering',
  gradeOrResult: 'First Class',
  issueDate: '2026-01-01',
  attributes: {},
});

const actor = { userId: 'user-1', institutionId: 'inst-1' };

/** Builds a full substitute dependency graph, with per-test overrides. */
const makeDeps = (overrides = {}) => {
  const transitions = [];
  const lifecycleService = {
    transition: jest.fn(async (certificateId, from, to, ctx) => {
      transitions.push({ certificateId, from, to, ctx });
      return { certificate_id: certificateId, status: to };
    }),
  };

  const deps = {
    certificateRepo: {
      insertPending: jest.fn(async (data) => ({ certificate_id: 'cert-1', ...data })),
      findByHash: jest.fn().mockResolvedValue(undefined),
    },
    fileRepo: { insert: jest.fn().mockResolvedValue({ file_id: 'file-1' }) },
    txRepo: { insert: jest.fn().mockResolvedValue({ transaction_id: 'tx-1' }) },
    userRepo: {
      resolveOrCreateStudentForIssuance: jest
        .fn()
        .mockResolvedValue({ studentId: 'student-1', userId: 'student-user-1', fullName: 'Asha Verma', email: 'asha@example.com' }),
    },
    institutionRepo: {
      findById: jest.fn().mockResolvedValue({ institution_id: 'inst-1', institution_code: 'SKIT', institution_name: 'SKIT College' }),
    },
    pdfAdapter: { compile: jest.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-fake'), templateVersion: 1 }) },
    pinataAdapter: { pin: jest.fn().mockResolvedValue({ cid: 'devcid-abc123' }) },
    chainAdapter: { anchor: jest.fn().mockResolvedValue({ txHash: '0xTXHASH', nonce: 1 }) },
    hashLib: { sha256Hex: jest.fn().mockReturnValue('a'.repeat(64)) },
    certIdLib: { allocateCertificateNumber: jest.fn().mockReturnValue('SKIT-2026-ABCDEFGHJKMN') },
    qrLib: { toBuffer: jest.fn().mockResolvedValue(Buffer.from('png-bytes')) },
    lifecycleService,
    auditRepo: { append: jest.fn().mockResolvedValue(undefined) },
    config: { verifyBaseUrl: 'http://localhost:5173/verify', chainNetwork: 'local', contractAddress: '0xabc' },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    withTransaction: jest.fn((fn) => fn({})),
    ...overrides,
  };

  return { deps, transitions };
};

describe('issuanceService.issue (pipeline orchestration, substitute dependencies)', () => {
  it('happy path: pins, anchors, and returns ANCHORING with a txHash', async () => {
    const { deps, transitions } = makeDeps();
    const service = createIssuanceService(deps);

    const result = await service.issue(baseInput(), actor);

    expect(result).toMatchObject({
      certificateId: 'cert-1',
      certificateNumber: 'SKIT-2026-ABCDEFGHJKMN',
      status: CERT_STATE.ANCHORING,
      txHash: '0xTXHASH',
      verifyUrl: 'http://localhost:5173/verify/SKIT-2026-ABCDEFGHJKMN',
    });

    expect(deps.certificateRepo.insertPending).toHaveBeenCalledTimes(1);
    expect(deps.pinataAdapter.pin).toHaveBeenCalledTimes(1);
    expect(deps.chainAdapter.anchor).toHaveBeenCalledWith('a'.repeat(64), 'devcid-abc123', 'cert-1');
    expect(transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      `${CERT_STATE.PENDING_STORAGE}->${CERT_STATE.PENDING_ANCHOR}`,
      `${CERT_STATE.PENDING_ANCHOR}->${CERT_STATE.ANCHORING}`,
    ]);
    expect(deps.auditRepo.append).toHaveBeenCalledWith('user-1', 'CERTIFICATE_ISSUED', 'certificate', 'cert-1', expect.any(Object));
  });

  it('rejects a future issue date without touching the database', async () => {
    const { deps } = makeDeps();
    const service = createIssuanceService(deps);

    await expect(service.issue({ ...baseInput(), issueDate: '2099-01-01' }, actor)).rejects.toMatchObject({
      code: ERROR_CODE.E_VALIDATION,
    });
    expect(deps.userRepo.resolveOrCreateStudentForIssuance).not.toHaveBeenCalled();
  });

  it('auto-provisions a student record on first-ever issuance to a new holder', async () => {
    const resolveOrCreateStudentForIssuance = jest
      .fn()
      .mockResolvedValue({ studentId: 'new-student-1', userId: 'new-user-1', fullName: 'Asha Verma', email: 'asha@example.com' });
    const { deps } = makeDeps({ userRepo: { resolveOrCreateStudentForIssuance } });
    const service = createIssuanceService(deps);

    const result = await service.issue(baseInput(), actor);

    expect(resolveOrCreateStudentForIssuance).toHaveBeenCalledWith(
      expect.objectContaining({
        institutionId: 'inst-1',
        enrollmentNumber: 'ENR-001',
        holderEmail: 'asha@example.com',
        holderName: 'Asha Verma',
        course: 'Computer Science & Engineering',
      }),
      expect.anything(),
    );
    expect(deps.certificateRepo.insertPending).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'new-student-1' }),
      expect.anything(),
    );
    expect(result.status).toBe(CERT_STATE.ANCHORING);
  });

  it('propagates a conflict when the holder email is already a student at a different institution', async () => {
    const conflict = Object.assign(new Error('already registered elsewhere'), { code: ERROR_CODE.E_VALIDATION });
    const { deps } = makeDeps({
      userRepo: { resolveOrCreateStudentForIssuance: jest.fn().mockRejectedValue(conflict) },
    });
    const service = createIssuanceService(deps);

    await expect(service.issue(baseInput(), actor)).rejects.toThrow('already registered elsewhere');
    expect(deps.certificateRepo.insertPending).not.toHaveBeenCalled();
  });

  it('on a certificate_hash unique violation, throws E_DUPLICATE_CERTIFICATE with the existing certificate in context', async () => {
    const conflictErr = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'certificate_certificate_hash_key' });
    const { deps } = makeDeps({
      certificateRepo: {
        insertPending: jest.fn().mockRejectedValue(conflictErr),
        findByHash: jest.fn().mockResolvedValue({ certificate_id: 'existing-cert', certificate_number: 'SKIT-2025-EXISTING0000' }),
      },
    });
    const service = createIssuanceService(deps);

    await expect(service.issue(baseInput(), actor)).rejects.toMatchObject({
      code: ERROR_CODE.E_DUPLICATE_CERTIFICATE,
      context: { existingCertificateId: 'existing-cert', existingCertificateNumber: 'SKIT-2025-EXISTING0000' },
    });
    // Never reaches Pinata/chain once a duplicate is detected at the DB layer.
    expect(deps.pinataAdapter.pin).not.toHaveBeenCalled();
  });

  it('retries certificate-number allocation on a certificate_number unique violation, then succeeds', async () => {
    const conflictErr = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'certificate_certificate_number_key' });
    let call = 0;
    const { deps } = makeDeps({
      certificateRepo: {
        insertPending: jest.fn(async (data) => {
          call += 1;
          if (call === 1) throw conflictErr;
          return { certificate_id: 'cert-1', ...data };
        }),
        findByHash: jest.fn(),
      },
      certIdLib: {
        allocateCertificateNumber: jest
          .fn()
          .mockReturnValueOnce('SKIT-2026-FIRSTATTEMPT1')
          .mockReturnValueOnce('SKIT-2026-SECONDATTEMPT'),
      },
    });
    const service = createIssuanceService(deps);

    const result = await service.issue(baseInput(), actor);
    expect(result.certificateNumber).toBe('SKIT-2026-SECONDATTEMPT');
    expect(deps.certificateRepo.insertPending).toHaveBeenCalledTimes(2);
  });

  it('on a storage (Pinata) failure, transitions straight to FAILED and never calls the chain', async () => {
    const pinErr = new Error('Pinata down');
    const { deps, transitions } = makeDeps({ pinataAdapter: { pin: jest.fn().mockRejectedValue(pinErr) } });
    const service = createIssuanceService(deps);

    await expect(service.issue(baseInput(), actor)).rejects.toThrow('Pinata down');

    expect(deps.chainAdapter.anchor).not.toHaveBeenCalled();
    expect(transitions).toEqual([
      {
        certificateId: 'cert-1',
        from: CERT_STATE.PENDING_STORAGE,
        to: CERT_STATE.FAILED,
        ctx: { actorUserId: 'user-1', extra: { failure_cause: 'Pinata down' } },
      },
    ]);
  });

  it('on a chain anchor failure, transitions PENDING_ANCHOR straight to FAILED', async () => {
    const chainErr = new Error('RPC unavailable');
    const { deps, transitions } = makeDeps({ chainAdapter: { anchor: jest.fn().mockRejectedValue(chainErr) } });
    const service = createIssuanceService(deps);

    await expect(service.issue(baseInput(), actor)).rejects.toThrow('RPC unavailable');

    expect(deps.txRepo.insert).not.toHaveBeenCalled();
    expect(transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      `${CERT_STATE.PENDING_STORAGE}->${CERT_STATE.PENDING_ANCHOR}`,
      `${CERT_STATE.PENDING_ANCHOR}->${CERT_STATE.FAILED}`,
    ]);
  });

  it('inserts the blockchain_transaction row with type ISSUE on success', async () => {
    const { deps } = makeDeps();
    const service = createIssuanceService(deps);
    await service.issue(baseInput(), actor);
    expect(deps.txRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ transactionType: TRANSACTION_TYPE.ISSUE, transactionHash: '0xTXHASH' }),
      expect.anything(),
    );
  });
});
