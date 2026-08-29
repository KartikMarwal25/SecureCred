import { describe, it, expect } from '@jest/globals';
import { CERT_STATE, ERROR_CODE } from '@securecred/shared';
import { createLifecycleService, ConcurrentTransitionError } from './lifecycleService.js';

/**
 * Per this project's test conventions: substitute adapters, never mock
 * internals. These are plain hand-written fakes that record their calls,
 * not a mocking framework.
 */
const makeFakeCertificateRepo = ({ updateStatusReturns } = {}) => {
  const calls = [];
  return {
    calls,
    updateStatus: async (certificateId, from, to, extra) => {
      calls.push({ certificateId, from, to, extra });
      if (updateStatusReturns === 'miss') return undefined;
      return { certificate_id: certificateId, status: to, ...extra };
    },
  };
};

const makeFakeAuditRepo = () => {
  const entries = [];
  return {
    entries,
    append: async (userId, action, entityType, entityId, detail) => {
      entries.push({ userId, action, entityType, entityId, detail });
      return { audit_id: `audit-${entries.length}` };
    },
  };
};

const fakeLogger = { warn: () => {}, info: () => {} };

describe('lifecycleService.transition', () => {
  it('performs a legal transition and writes an audit entry', async () => {
    const certificateRepo = makeFakeCertificateRepo();
    const auditRepo = makeFakeAuditRepo();
    const lifecycleService = createLifecycleService({ certificateRepo, auditRepo, logger: fakeLogger });

    const updated = await lifecycleService.transition('cert-1', CERT_STATE.PENDING_STORAGE, CERT_STATE.PENDING_ANCHOR, {
      actorUserId: 'user-1',
    });

    expect(updated.status).toBe(CERT_STATE.PENDING_ANCHOR);
    expect(certificateRepo.calls).toEqual([
      { certificateId: 'cert-1', from: CERT_STATE.PENDING_STORAGE, to: CERT_STATE.PENDING_ANCHOR, extra: {} },
    ]);
    expect(auditRepo.entries).toHaveLength(1);
    expect(auditRepo.entries[0].action).toBe('CERTIFICATE_STATUS_CHANGED');
    expect(auditRepo.entries[0].detail).toEqual({ from: CERT_STATE.PENDING_STORAGE, to: CERT_STATE.PENDING_ANCHOR });
  });

  it('rejects an illegal transition, writes an audit entry, and never calls updateStatus', async () => {
    const certificateRepo = makeFakeCertificateRepo();
    const auditRepo = makeFakeAuditRepo();
    const lifecycleService = createLifecycleService({ certificateRepo, auditRepo, logger: fakeLogger });

    await expect(
      lifecycleService.transition('cert-1', CERT_STATE.ACTIVE, CERT_STATE.PENDING_STORAGE, { actorUserId: 'user-1' }),
    ).rejects.toMatchObject({ code: ERROR_CODE.E_ILLEGAL_TRANSITION });

    // The illegal transition must never reach certificateRepo.updateStatus.
    expect(certificateRepo.calls).toHaveLength(0);
    expect(auditRepo.entries).toHaveLength(1);
    expect(auditRepo.entries[0].action).toBe('CERTIFICATE_ILLEGAL_TRANSITION');
    expect(auditRepo.entries[0].detail).toEqual({ from: CERT_STATE.ACTIVE, to: CERT_STATE.PENDING_STORAGE, reason: null });
  });

  it('rejects revoked->anything (terminal state has no legal edges)', async () => {
    const certificateRepo = makeFakeCertificateRepo();
    const auditRepo = makeFakeAuditRepo();
    const lifecycleService = createLifecycleService({ certificateRepo, auditRepo, logger: fakeLogger });

    await expect(
      lifecycleService.transition('cert-1', CERT_STATE.REVOKED, CERT_STATE.ACTIVE, {}),
    ).rejects.toMatchObject({ code: ERROR_CODE.E_ILLEGAL_TRANSITION });
  });

  it('throws ConcurrentTransitionError when the compare-and-set loses the race', async () => {
    const certificateRepo = makeFakeCertificateRepo({ updateStatusReturns: 'miss' });
    const auditRepo = makeFakeAuditRepo();
    const lifecycleService = createLifecycleService({ certificateRepo, auditRepo, logger: fakeLogger });

    await expect(
      lifecycleService.transition('cert-1', CERT_STATE.PENDING_STORAGE, CERT_STATE.PENDING_ANCHOR, {}),
    ).rejects.toBeInstanceOf(ConcurrentTransitionError);

    // A lost race is not an illegal transition — no audit entry for it.
    expect(auditRepo.entries).toHaveLength(0);
  });
});
