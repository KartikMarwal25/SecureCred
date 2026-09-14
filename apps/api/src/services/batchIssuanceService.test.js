import { describe, it, expect, jest } from '@jest/globals';
import { createBatchIssuanceService, MAX_BATCH_ROWS } from './batchIssuanceService.js';

const actor = { userId: 'user-1', institutionId: 'inst-1' };

const validRow = (n) => ({
  holderName: `Student ${n}`,
  holderEmail: `student${n}@example.com`,
  enrollmentNumber: `ENR-00${n}`,
  title: 'Bachelor of Technology',
  certificateType: 'DEGREE',
  course: 'Computer Science & Engineering',
  issueDate: '2026-01-01',
});

const csvOf = (rows) => {
  const header = Object.keys(rows[0]).join(',');
  const lines = rows.map((r) => Object.values(r).join(','));
  return [header, ...lines].join('\n');
};

/** In-memory fake standing in for batchIssuance.repo.js — real enough to
 * exercise createBatch/processBatch's actual read-modify-write flow, without
 * a real Postgres connection. Also exposes _seedJob/_seedRows (test-only,
 * not part of the real repo's interface) so resume tests can construct a
 * "stalled mid-batch" state directly, without needing to actually crash
 * anything mid-process. */
const makeFakeRepo = () => {
  let jobs = new Map();
  let rows = new Map(); // batchJobId -> row[]
  let jobCounter = 0;
  let rowCounter = 0;

  return {
    createJob: jest.fn(async ({ institutionId, createdBy, totalRows }) => {
      jobCounter += 1;
      const job = {
        batch_job_id: `job-${jobCounter}`,
        institution_id: institutionId,
        created_by: createdBy,
        status: 'PENDING',
        total_rows: totalRows,
        processed_rows: 0,
        succeeded_rows: 0,
        failed_rows: 0,
        updated_at: new Date().toISOString(),
      };
      jobs.set(job.batch_job_id, job);
      rows.set(job.batch_job_id, []);
      return job;
    }),
    insertRows: jest.fn(async (batchJobId, inputRows) => {
      const inserted = inputRows.map((inputData, i) => {
        rowCounter += 1;
        return {
          batch_row_id: `row-${rowCounter}`,
          batch_job_id: batchJobId,
          row_number: i + 1,
          input_data: inputData,
          status: 'PENDING',
          certificate_id: null,
          error_message: null,
          started_at: null,
        };
      });
      rows.set(batchJobId, inserted);
      return inserted;
    }),
    markRowStarted: jest.fn(async (batchRowId) => {
      for (const jobRows of rows.values()) {
        const row = jobRows.find((r) => r.batch_row_id === batchRowId);
        if (row) {
          row.started_at = new Date().toISOString();
          return row;
        }
      }
      return undefined;
    }),
    markRowDone: jest.fn(async (batchRowId, status, { certificateId = null, errorMessage = null } = {}) => {
      for (const jobRows of rows.values()) {
        const row = jobRows.find((r) => r.batch_row_id === batchRowId);
        if (row) {
          row.status = status;
          row.certificate_id = certificateId;
          row.error_message = errorMessage;
          return row;
        }
      }
      return undefined;
    }),
    incrementProgress: jest.fn(async (batchJobId, succeeded) => {
      const job = jobs.get(batchJobId);
      job.processed_rows += 1;
      if (succeeded) job.succeeded_rows += 1;
      else job.failed_rows += 1;
      job.status = 'PROCESSING';
      job.updated_at = new Date().toISOString();
      return job;
    }),
    markJobCompleted: jest.fn(async (batchJobId) => {
      const job = jobs.get(batchJobId);
      job.status = 'COMPLETED';
      job.completed_at = new Date().toISOString();
      job.updated_at = job.completed_at;
      return job;
    }),
    findJobById: jest.fn(async (batchJobId) => jobs.get(batchJobId)),
    findRowsByJobId: jest.fn(async (batchJobId) => rows.get(batchJobId) ?? []),
    findPendingRowsByJobId: jest.fn(async (batchJobId) => (rows.get(batchJobId) ?? []).filter((r) => r.status === 'PENDING')),
    findStalledJobs: jest.fn(async () => [...jobs.values()].filter((j) => j.status === 'PENDING' || j.status === 'PROCESSING')),
    _seedJob: (job) => {
      jobs.set(job.batch_job_id, job);
      if (!rows.has(job.batch_job_id)) rows.set(job.batch_job_id, []);
    },
    _seedRows: (batchJobId, rowList) => rows.set(batchJobId, rowList),
  };
};

const logger = { info: () => {}, warn: () => {}, error: () => {} };

describe('batchIssuanceService', () => {
  it('creates a job, processes every row through issuanceService.issue, and reaches COMPLETED', async () => {
    const batchIssuanceRepo = makeFakeRepo();
    const issuedFor = [];
    const issuanceService = {
      issue: jest.fn(async (input) => {
        issuedFor.push(input.enrollmentNumber);
        return { certificateId: `cert-${input.enrollmentNumber}` };
      }),
    };
    const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

    const csv = csvOf([validRow(1), validRow(2), validRow(3)]);
    const { batchJobId, totalRows } = await service.createBatch(csv, actor);

    expect(totalRows).toBe(3);
    expect(batchIssuanceRepo.createJob).toHaveBeenCalledWith({ institutionId: 'inst-1', createdBy: 'user-1', totalRows: 3 });

    // Background processing is fire-and-forget — wait for it to settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(issuanceService.issue).toHaveBeenCalledTimes(3);
    // Rows must be issued in CSV order, not some other order.
    expect(issuedFor).toEqual(['ENR-001', 'ENR-002', 'ENR-003']);

    const finalStatus = await service.getBatchStatus(batchJobId);
    expect(finalStatus.job.status).toBe('COMPLETED');
    expect(finalStatus.job.succeeded_rows).toBe(3);
    expect(finalStatus.job.failed_rows).toBe(0);
    expect(finalStatus.rows.every((r) => r.status === 'SUCCEEDED')).toBe(true);
  });

  it('one bad row fails without blocking the rows around it', async () => {
    const batchIssuanceRepo = makeFakeRepo();
    const issuanceService = {
      issue: jest.fn(async (input) => {
        if (input.enrollmentNumber === 'ENR-002') {
          throw new Error('duplicate certificate content');
        }
        return { certificateId: `cert-${input.enrollmentNumber}` };
      }),
    };
    const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

    const csv = csvOf([validRow(1), validRow(2), validRow(3)]);
    const { batchJobId } = await service.createBatch(csv, actor);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const status = await service.getBatchStatus(batchJobId);
    expect(status.job.status).toBe('COMPLETED');
    expect(status.job.succeeded_rows).toBe(2);
    expect(status.job.failed_rows).toBe(1);
    expect(status.rows[0].status).toBe('SUCCEEDED');
    expect(status.rows[1].status).toBe('FAILED');
    expect(status.rows[1].error_message).toMatch(/duplicate certificate content/);
    expect(status.rows[2].status).toBe('SUCCEEDED');
  });

  it('a row whose certificate was created but is still retrying a transient outage is marked SUCCEEDED, not FAILED', async () => {
    // issuanceService throws with publicMeta.certificateId set when it
    // exhausted its own in-request retries for a transient Pinata/RPC
    // outage but the certificate row was already created and is queued for
    // the worker's reconciler. That's real, ongoing progress — reporting
    // it as FAILED would hide a certificate that's actually still on its way.
    const batchIssuanceRepo = makeFakeRepo();
    const stillRetryingError = Object.assign(new Error('Pinata unavailable'), {
      publicMeta: { certificateId: 'cert-still-retrying', certificateNumber: 'SKIT-2026-STILLGOING01' },
    });
    const issuanceService = {
      issue: jest.fn(async (input) => {
        if (input.enrollmentNumber === 'ENR-002') throw stillRetryingError;
        return { certificateId: `cert-${input.enrollmentNumber}` };
      }),
    };
    const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

    const csv = csvOf([validRow(1), validRow(2), validRow(3)]);
    const { batchJobId } = await service.createBatch(csv, actor);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const status = await service.getBatchStatus(batchJobId);
    expect(status.job.succeeded_rows).toBe(3);
    expect(status.job.failed_rows).toBe(0);
    expect(status.rows[1]).toMatchObject({ status: 'SUCCEEDED', certificate_id: 'cert-still-retrying' });
  });

  it('a row failing schema validation is marked FAILED without ever calling issuanceService.issue for it', async () => {
    const batchIssuanceRepo = makeFakeRepo();
    const issuanceService = { issue: jest.fn(async () => ({ certificateId: 'cert-x' })) };
    const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

    const badRow = { ...validRow(1), holderEmail: 'not-an-email', certificateType: 'DEGREE' };
    const csv = csvOf([validRow(1), badRow]);
    const { batchJobId } = await service.createBatch(csv, actor);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const status = await service.getBatchStatus(batchJobId);
    expect(status.job.succeeded_rows).toBe(1);
    expect(status.job.failed_rows).toBe(1);
    expect(status.rows[1].status).toBe('FAILED');
    expect(issuanceService.issue).toHaveBeenCalledTimes(1);
  });

  it('rejects a CSV missing a required column before creating any job', async () => {
    const batchIssuanceRepo = makeFakeRepo();
    const issuanceService = { issue: jest.fn() };
    const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

    const csv = 'holderName,holderEmail\nAsha,asha@example.com';
    await expect(service.createBatch(csv, actor)).rejects.toThrow(/missing required column/i);
    expect(batchIssuanceRepo.createJob).not.toHaveBeenCalled();
  });

  it('rejects an empty CSV before creating any job', async () => {
    const batchIssuanceRepo = makeFakeRepo();
    const issuanceService = { issue: jest.fn() };
    const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

    await expect(service.createBatch('', actor)).rejects.toThrow();
    expect(batchIssuanceRepo.createJob).not.toHaveBeenCalled();
  });

  it('rejects a CSV with more than MAX_BATCH_ROWS rows before creating any job', async () => {
    const batchIssuanceRepo = makeFakeRepo();
    const issuanceService = { issue: jest.fn() };
    const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

    const tooManyRows = Array.from({ length: MAX_BATCH_ROWS + 1 }, (_, i) => validRow(i + 1));
    const csv = csvOf(tooManyRows);
    await expect(service.createBatch(csv, actor)).rejects.toThrow(new RegExp(`limited to ${MAX_BATCH_ROWS} rows`));
    expect(batchIssuanceRepo.createJob).not.toHaveBeenCalled();
  });

  it('accepts a CSV with exactly MAX_BATCH_ROWS rows', async () => {
    const batchIssuanceRepo = makeFakeRepo();
    const issuanceService = { issue: jest.fn(async (input) => ({ certificateId: `cert-${input.enrollmentNumber}` })) };
    const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

    const exactRows = Array.from({ length: MAX_BATCH_ROWS }, (_, i) => validRow(i + 1));
    const csv = csvOf(exactRows);
    const { totalRows } = await service.createBatch(csv, actor);
    expect(totalRows).toBe(MAX_BATCH_ROWS);
  });

  it('getBatchStatus returns null for an unknown job id', async () => {
    const batchIssuanceRepo = makeFakeRepo();
    const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService: { issue: jest.fn() }, logger });

    expect(await service.getBatchStatus('nonexistent')).toBeNull();
  });

  describe('resumeStalledBatches (recovery after the process running a batch crashed or restarted)', () => {
    const seedStalledJob = (batchIssuanceRepo, jobId, rows) => {
      const job = {
        batch_job_id: jobId,
        institution_id: 'inst-1',
        created_by: 'user-1',
        status: 'PROCESSING',
        total_rows: rows.length,
        processed_rows: rows.filter((r) => r.status !== 'PENDING').length,
        succeeded_rows: rows.filter((r) => r.status === 'SUCCEEDED').length,
        failed_rows: rows.filter((r) => r.status === 'FAILED').length,
        updated_at: new Date(Date.now() - 999_000).toISOString(),
      };
      batchIssuanceRepo._seedJob(job);
      batchIssuanceRepo._seedRows(jobId, rows);
      return job;
    };

    it('resumes only the still-PENDING rows of a stalled job — rows already SUCCEEDED are never reprocessed', async () => {
      const batchIssuanceRepo = makeFakeRepo();
      const issuanceService = { issue: jest.fn(async (input) => ({ certificateId: `cert-${input.enrollmentNumber}` })) };
      const certificateRepo = { findByStudentTitleDate: jest.fn() };
      const userRepo = { findStudentByEnrollment: jest.fn() };
      const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, certificateRepo, userRepo, logger });

      const jobId = 'job-stalled-1';
      seedStalledJob(batchIssuanceRepo, jobId, [
        {
          batch_row_id: 'row-1',
          batch_job_id: jobId,
          row_number: 1,
          input_data: validRow(1),
          status: 'SUCCEEDED',
          certificate_id: 'cert-already-done',
          error_message: null,
          started_at: '2026-01-01T00:00:00.000Z',
        },
        {
          batch_row_id: 'row-2',
          batch_job_id: jobId,
          row_number: 2,
          input_data: validRow(2),
          status: 'PENDING',
          certificate_id: null,
          error_message: null,
          started_at: null,
        },
      ]);

      const { resumedJobs } = await service.resumeStalledBatches(120);

      expect(resumedJobs).toBe(1);
      // Never touches the row that already finished, nor the duplicate check for it.
      expect(issuanceService.issue).toHaveBeenCalledTimes(1);
      expect(issuanceService.issue).toHaveBeenCalledWith(
        expect.objectContaining({ enrollmentNumber: 'ENR-002' }),
        { userId: 'user-1', institutionId: 'inst-1' },
      );
      expect(certificateRepo.findByStudentTitleDate).not.toHaveBeenCalled();

      const status = await service.getBatchStatus(jobId);
      expect(status.rows[0]).toMatchObject({ status: 'SUCCEEDED', certificate_id: 'cert-already-done' });
      expect(status.rows[1]).toMatchObject({ status: 'SUCCEEDED' });
      expect(status.job.status).toBe('COMPLETED');
    });

    it('a row interrupted mid-issuance (started_at already set) is linked to its existing certificate instead of being reissued', async () => {
      const batchIssuanceRepo = makeFakeRepo();
      const issuanceService = { issue: jest.fn() };
      const existingCertificate = { certificate_id: 'cert-created-before-crash' };
      const certificateRepo = { findByStudentTitleDate: jest.fn().mockResolvedValue(existingCertificate) };
      const userRepo = { findStudentByEnrollment: jest.fn().mockResolvedValue({ studentId: 'student-1' }) };
      const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, certificateRepo, userRepo, logger });

      const jobId = 'job-stalled-2';
      const row1 = validRow(1);
      seedStalledJob(batchIssuanceRepo, jobId, [
        {
          batch_row_id: 'row-1',
          batch_job_id: jobId,
          row_number: 1,
          input_data: row1,
          status: 'PENDING',
          certificate_id: null,
          error_message: null,
          // Non-null: a previous attempt began (issuanceService.issue was
          // called) but the process died before the outcome was recorded.
          started_at: '2026-01-01T00:00:00.000Z',
        },
      ]);

      await service.resumeStalledBatches(120);

      expect(userRepo.findStudentByEnrollment).toHaveBeenCalledWith('inst-1', row1.enrollmentNumber);
      expect(certificateRepo.findByStudentTitleDate).toHaveBeenCalledWith('student-1', row1.title, row1.issueDate);
      // The whole point: never re-run the issuance pipeline for a row that
      // may have already produced a real certificate.
      expect(issuanceService.issue).not.toHaveBeenCalled();

      const status = await service.getBatchStatus(jobId);
      expect(status.rows[0]).toMatchObject({ status: 'SUCCEEDED', certificate_id: 'cert-created-before-crash' });
      expect(status.job.status).toBe('COMPLETED');
    });

    it('a row interrupted mid-issuance with NO existing certificate found is safely retried through the normal pipeline', async () => {
      const batchIssuanceRepo = makeFakeRepo();
      const issuanceService = { issue: jest.fn(async (input) => ({ certificateId: `cert-${input.enrollmentNumber}` })) };
      const certificateRepo = { findByStudentTitleDate: jest.fn().mockResolvedValue(undefined) };
      const userRepo = { findStudentByEnrollment: jest.fn().mockResolvedValue({ studentId: 'student-1' }) };
      const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, certificateRepo, userRepo, logger });

      const jobId = 'job-stalled-3';
      seedStalledJob(batchIssuanceRepo, jobId, [
        {
          batch_row_id: 'row-1',
          batch_job_id: jobId,
          row_number: 1,
          input_data: validRow(1),
          status: 'PENDING',
          certificate_id: null,
          error_message: null,
          started_at: '2026-01-01T00:00:00.000Z',
        },
      ]);

      await service.resumeStalledBatches(120);

      expect(issuanceService.issue).toHaveBeenCalledTimes(1);
      const status = await service.getBatchStatus(jobId);
      expect(status.rows[0].status).toBe('SUCCEEDED');
    });

    it('a stalled job with zero PENDING rows left is marked COMPLETED without reprocessing anything', async () => {
      const batchIssuanceRepo = makeFakeRepo();
      const issuanceService = { issue: jest.fn() };
      const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

      const jobId = 'job-stalled-4';
      seedStalledJob(batchIssuanceRepo, jobId, [
        { batch_row_id: 'row-1', batch_job_id: jobId, row_number: 1, input_data: validRow(1), status: 'SUCCEEDED', certificate_id: 'cert-1', error_message: null, started_at: '2026-01-01T00:00:00.000Z' },
        { batch_row_id: 'row-2', batch_job_id: jobId, row_number: 2, input_data: validRow(2), status: 'FAILED', certificate_id: null, error_message: 'bad row', started_at: '2026-01-01T00:00:00.000Z' },
      ]);

      await service.resumeStalledBatches(120);

      expect(issuanceService.issue).not.toHaveBeenCalled();
      const status = await service.getBatchStatus(jobId);
      expect(status.job.status).toBe('COMPLETED');
    });

    it('does nothing when there are no stalled jobs', async () => {
      const batchIssuanceRepo = makeFakeRepo();
      const issuanceService = { issue: jest.fn() };
      const service = createBatchIssuanceService({ batchIssuanceRepo, issuanceService, logger });

      const { resumedJobs } = await service.resumeStalledBatches(120);
      expect(resumedJobs).toBe(0);
      expect(issuanceService.issue).not.toHaveBeenCalled();
    });
  });
});
