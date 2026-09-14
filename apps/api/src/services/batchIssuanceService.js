/**
 * Batch (CSV) certificate issuance. Reuses issuanceService.issue() for every
 * row — one certificate at a time, in row order — rather than re-implementing
 * the issuance pipeline: the persist-before-external-call guarantee, PDF
 * compile, IPFS pin, and on-chain anchor all stay exactly as battle-tested
 * for a single issuance. What this module adds is CSV parsing, per-row
 * validation that doesn't let one bad row block the rest, and progress
 * tracking so a large upload can be polled instead of blocking one HTTP
 * request for however long hundreds of anchors take to broadcast.
 *
 * Concurrency note: rows are processed sequentially (one full issue() call
 * awaited before the next starts). chain.adapter.js's own write queue would
 * make concurrent processing nonce-safe too, but sequential processing keeps
 * failure isolation simple (a DB error on row 12 doesn't leave rows 10-14 in
 * an ambiguous interleaved state) and batch throughput is bound by IPFS
 * pinning latency anyway, not by chain broadcast — parallelizing wouldn't
 * meaningfully speed this up.
 */
import { issuanceRequestSchema } from '@securecred/shared';
import { parseCsv } from '../lib/csv.js';

// A per-request row cap, independent of the per-hour issuanceLimiter applied
// to this route: without one, a single batch upload could mint far more
// certificates than the hourly rate limit was ever meant to allow in one
// request (the limiter throttles how often a batch can be *submitted*, not
// how large one is). 500 is generous for a real cohort-sized batch.
export const MAX_BATCH_ROWS = 500;

const REQUIRED_COLUMNS = [
  'holderName',
  'holderEmail',
  'enrollmentNumber',
  'title',
  'certificateType',
  'course',
  'issueDate',
];

/**
 * Creates the batch issuance service.
 *
 * @param {object} deps
 * @param {object} deps.batchIssuanceRepo
 * @param {object} deps.issuanceService
 * @param {object} deps.certificateRepo - Used only by the stalled-row resume path's duplicate check.
 * @param {object} deps.userRepo - Used only by the stalled-row resume path's duplicate check (findStudentByEnrollment).
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen service: `{ createBatch, getBatchStatus, resumeStalledBatches }`.
 */
export const createBatchIssuanceService = ({ batchIssuanceRepo, issuanceService, certificateRepo, userRepo, logger }) => {
  /**
   * Parses and validates a CSV upload, creates the job + one row per CSV
   * line, then starts processing in the background (not awaited — the
   * caller gets the job id back immediately and polls `getBatchStatus`).
   *
   * @param {string} csvContent - Raw CSV file content.
   * @param {{userId: string, institutionId: string}} actor
   * @returns {Promise<{batchJobId: string, totalRows: number}>}
   * @throws {Error} If the CSV is malformed (empty, wrong column count) or missing a required column header.
   */
  const createBatch = async (csvContent, actor) => {
    const parsedRows = parseCsv(csvContent);
    if (parsedRows.length === 0) {
      throw new Error('The CSV file has no data rows.');
    }
    if (parsedRows.length > MAX_BATCH_ROWS) {
      throw new Error(`A single batch is limited to ${MAX_BATCH_ROWS} rows (this file has ${parsedRows.length}) — split it into smaller batches.`);
    }

    const headerFields = Object.keys(parsedRows[0]);
    const missingColumns = REQUIRED_COLUMNS.filter((col) => !headerFields.includes(col));
    if (missingColumns.length > 0) {
      throw new Error(`The CSV is missing required column(s): ${missingColumns.join(', ')}.`);
    }

    const job = await batchIssuanceRepo.createJob({
      institutionId: actor.institutionId,
      createdBy: actor.userId,
      totalRows: parsedRows.length,
    });
    const rows = await batchIssuanceRepo.insertRows(job.batch_job_id, parsedRows);

    // Deliberately not awaited: the HTTP response returns as soon as the job
    // and its rows are persisted; processing continues in the background and
    // is polled via getBatchStatus(). A failure inside processBatch is
    // caught and logged there — it must never become an unhandled rejection.
    processBatch(job.batch_job_id, rows, actor).catch((err) => {
      logger?.error?.({ err, batchJobId: job.batch_job_id }, 'batchIssuanceService: background processing crashed');
    });

    return { batchJobId: job.batch_job_id, totalRows: parsedRows.length };
  };

  /**
   * Processes every row of a batch job sequentially, marking each row
   * SUCCEEDED or FAILED and advancing the job's progress counters as it
   * goes. Never throws — a row-level failure is recorded on that row, not
   * propagated.
   *
   * @param {string} batchJobId
   * @param {object[]} rows - The just-inserted row records, in row-number order.
   * @param {{userId: string, institutionId: string}} actor
   * @returns {Promise<void>}
   */
  const processBatch = async (batchJobId, rows, actor) => {
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop -- rows must be processed one at a time, not in parallel (see module comment)
      await processRow(batchJobId, row, actor);
    }
    await batchIssuanceRepo.markJobCompleted(batchJobId);
  };

  /**
   * Looks for a certificate that already exists for a row about to be
   * (re)attempted — only meaningful when the row's previous attempt was
   * interrupted before it could record SUCCEEDED/FAILED (see processRow).
   * Matched on student + title + issue date: the only natural business key
   * available, since certificate_number/certificate_hash are both generated
   * fresh per attempt and would never collide with an earlier interrupted
   * one.
   *
   * @param {object} input - issuanceRequestSchema-validated row data.
   * @param {{userId: string, institutionId: string}} actor
   * @returns {Promise<object|undefined>}
   */
  const findExistingCertificateForRow = async (input, actor) => {
    const student = await userRepo.findStudentByEnrollment(actor.institutionId, input.enrollmentNumber);
    if (!student) return undefined;
    return certificateRepo.findByStudentTitleDate(student.studentId, input.title, input.issueDate);
  };

  /**
   * @param {string} batchJobId
   * @param {object} row - A batch_issuance_row record (input_data is the raw parsed CSV row).
   * @param {{userId: string, institutionId: string}} actor
   * @returns {Promise<void>}
   */
  const processRow = async (batchJobId, row, actor) => {
    const validation = issuanceRequestSchema.safeParse(row.input_data);
    if (!validation.success) {
      const message = validation.error.issues.map((issue) => issue.message).join('; ');
      await batchIssuanceRepo.markRowDone(row.batch_row_id, 'FAILED', { errorMessage: message });
      await batchIssuanceRepo.incrementProgress(batchJobId, false);
      return;
    }

    // A non-null started_at on a row we're about to process means a
    // PREVIOUS attempt began but the process died before recording an
    // outcome — the certificate pipeline may have already run far enough to
    // create a real certificate for this row. Check before reissuing, or a
    // resumed batch could silently double-issue.
    const isRetryOfInterruptedAttempt = row.started_at !== null;
    await batchIssuanceRepo.markRowStarted(row.batch_row_id);

    if (isRetryOfInterruptedAttempt) {
      const existing = await findExistingCertificateForRow(validation.data, actor);
      if (existing) {
        await batchIssuanceRepo.markRowDone(row.batch_row_id, 'SUCCEEDED', { certificateId: existing.certificate_id });
        await batchIssuanceRepo.incrementProgress(batchJobId, true);
        return;
      }
    }

    try {
      const result = await issuanceService.issue(validation.data, actor);
      await batchIssuanceRepo.markRowDone(row.batch_row_id, 'SUCCEEDED', { certificateId: result.certificateId });
      await batchIssuanceRepo.incrementProgress(batchJobId, true);
    } catch (err) {
      if (err.publicMeta?.certificateId) {
        // issuanceService exhausted its own in-request retries for a
        // transient Pinata/RPC outage but the certificate WAS created and
        // is left queued for the worker's reconciler to keep retrying —
        // not a genuine failure. Link it so this row reflects real,
        // ongoing progress instead of a false dead-end that would hide a
        // certificate that's actually still on its way.
        await batchIssuanceRepo.markRowDone(row.batch_row_id, 'SUCCEEDED', { certificateId: err.publicMeta.certificateId });
        await batchIssuanceRepo.incrementProgress(batchJobId, true);
        return;
      }
      await batchIssuanceRepo.markRowDone(row.batch_row_id, 'FAILED', {
        errorMessage: String(err.message ?? 'Issuance failed').slice(0, 500),
      });
      await batchIssuanceRepo.incrementProgress(batchJobId, false);
    }
  };

  /**
   * @param {string} batchJobId
   * @returns {Promise<{job: object, rows: object[]}|null>}
   */
  const getBatchStatus = async (batchJobId) => {
    const job = await batchIssuanceRepo.findJobById(batchJobId);
    if (!job) return null;
    const rows = await batchIssuanceRepo.findRowsByJobId(batchJobId);
    return { job, rows };
  };

  /**
   * Resumes exactly one stalled job from its still-PENDING rows — rows
   * already SUCCEEDED/FAILED are never revisited, so this picks up "from
   * there," not "from the start." A row whose previous attempt was
   * interrupted mid-flight is protected by processRow's own duplicate check.
   *
   * @param {object} job - A batch_issuance_job record.
   * @returns {Promise<void>}
   */
  const resumeJob = async (job) => {
    const pendingRows = await batchIssuanceRepo.findPendingRowsByJobId(job.batch_job_id);
    if (pendingRows.length === 0) {
      // Every row already reached a terminal status, but the process died
      // before this job itself got marked COMPLETED — finish the bookkeeping.
      await batchIssuanceRepo.markJobCompleted(job.batch_job_id);
      return;
    }
    const actor = { userId: job.created_by, institutionId: job.institution_id };
    await processBatch(job.batch_job_id, pendingRows, actor);
  };

  /**
   * Finds every batch job that stopped making progress (created or last
   * updated more than `thresholdSec` ago, still PENDING/PROCESSING — i.e.
   * the process that was running it crashed, restarted, or was redeployed
   * mid-batch) and resumes each one from exactly where it stopped. Meant to
   * be called periodically by the worker, the same way reconciler.js sweeps
   * stalled certificates.
   *
   * @param {number} thresholdSec
   * @returns {Promise<{resumedJobs: number}>}
   */
  const resumeStalledBatches = async (thresholdSec) => {
    const stalledJobs = await batchIssuanceRepo.findStalledJobs(thresholdSec);
    if (stalledJobs.length === 0) return { resumedJobs: 0 };

    logger?.info?.({ count: stalledJobs.length }, 'batchIssuanceService: resuming stalled batch jobs');
    for (const job of stalledJobs) {
      // Jobs are resumed one at a time, not in parallel — matches
      // processBatch's own row-at-a-time reasoning (simple failure
      // isolation; batch throughput is bound by IPFS/chain latency, not by
      // how many jobs run concurrently).
      await resumeJob(job).catch((err) => {
        logger?.error?.({ err, batchJobId: job.batch_job_id }, 'batchIssuanceService: failed to resume stalled batch job');
      });
    }
    return { resumedJobs: stalledJobs.length };
  };

  return Object.freeze({ createBatch, getBatchStatus, resumeStalledBatches });
};
