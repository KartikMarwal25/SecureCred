/**
 * Raw parameterized SQL for `batch_issuance_job` / `batch_issuance_row`.
 * Only repositories/ may import 'pg' (rule D3).
 */

const JOB_COLUMNS =
  'batch_job_id, institution_id, created_by, status, total_rows, processed_rows, succeeded_rows, failed_rows, created_at, updated_at, completed_at';
const ROW_COLUMNS =
  'batch_row_id, batch_job_id, row_number, input_data, status, certificate_id, error_message, started_at, processed_at';

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {object} Frozen repository object.
 */
export const createBatchIssuanceRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * @param {{institutionId: string, createdBy: string, totalRows: number}} params
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The inserted job row.
   */
  const createJob = async ({ institutionId, createdBy, totalRows }, client) => {
    const { rows } = await exec(client).query(
      `INSERT INTO batch_issuance_job (institution_id, created_by, total_rows)
       VALUES ($1,$2,$3)
       RETURNING ${JOB_COLUMNS}`,
      [institutionId, createdBy, totalRows],
    );
    return rows[0];
  };

  /**
   * @param {string[]} rowsInputData - Each row's parsed (pre-validation) CSV data, in order.
   * @param {string} batchJobId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>} The inserted row records, in row-number order.
   */
  const insertRows = async (batchJobId, rowsInputData, client) => {
    const values = [];
    const params = [];
    rowsInputData.forEach((inputData, i) => {
      const rowNumber = i + 1;
      const base = params.length;
      values.push(`($${base + 1},$${base + 2},$${base + 3})`);
      params.push(batchJobId, rowNumber, JSON.stringify(inputData));
    });
    const { rows } = await exec(client).query(
      `INSERT INTO batch_issuance_row (batch_job_id, row_number, input_data)
       VALUES ${values.join(',')}
       RETURNING ${ROW_COLUMNS}`,
      params,
    );
    return rows.sort((a, b) => a.row_number - b.row_number);
  };

  /**
   * @param {string} batchRowId
   * @param {'SUCCEEDED'|'FAILED'} status
   * @param {{certificateId?: string, errorMessage?: string}} outcome
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>}
   */
  const markRowDone = async (batchRowId, status, { certificateId = null, errorMessage = null } = {}, client) => {
    const { rows } = await exec(client).query(
      `UPDATE batch_issuance_row
       SET status = $2, certificate_id = $3, error_message = $4, processed_at = now()
       WHERE batch_row_id = $1
       RETURNING ${ROW_COLUMNS}`,
      [batchRowId, status, certificateId, errorMessage],
    );
    return rows[0];
  };

  /**
   * Marks a row as "an attempt has begun" without changing its status
   * (still PENDING) — persisted BEFORE the issuance pipeline is called, so a
   * process crash mid-row leaves evidence that a certificate might already
   * exist for it (see batchIssuanceService.js's duplicate check on resume).
   *
   * @param {string} batchRowId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>}
   */
  const markRowStarted = async (batchRowId, client) => {
    const { rows } = await exec(client).query(
      `UPDATE batch_issuance_row SET started_at = now() WHERE batch_row_id = $1 RETURNING ${ROW_COLUMNS}`,
      [batchRowId],
    );
    return rows[0];
  };

  /**
   * Atomically advances the job's progress counters by one processed row.
   *
   * @param {string} batchJobId
   * @param {boolean} succeeded
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The updated job row.
   */
  const incrementProgress = async (batchJobId, succeeded, client) => {
    const { rows } = await exec(client).query(
      `UPDATE batch_issuance_job
       SET processed_rows = processed_rows + 1,
           succeeded_rows = succeeded_rows + CASE WHEN $2 THEN 1 ELSE 0 END,
           failed_rows = failed_rows + CASE WHEN $2 THEN 0 ELSE 1 END,
           status = 'PROCESSING',
           updated_at = now()
       WHERE batch_job_id = $1
       RETURNING ${JOB_COLUMNS}`,
      [batchJobId, succeeded],
    );
    return rows[0];
  };

  /**
   * @param {string} batchJobId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>}
   */
  const markJobCompleted = async (batchJobId, client) => {
    const { rows } = await exec(client).query(
      `UPDATE batch_issuance_job
       SET status = 'COMPLETED', completed_at = now(), updated_at = now()
       WHERE batch_job_id = $1
       RETURNING ${JOB_COLUMNS}`,
      [batchJobId],
    );
    return rows[0];
  };

  /**
   * @param {string} batchJobId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>}
   */
  const findJobById = async (batchJobId, client) => {
    const { rows } = await exec(client).query(`SELECT ${JOB_COLUMNS} FROM batch_issuance_job WHERE batch_job_id = $1`, [
      batchJobId,
    ]);
    return rows[0];
  };

  /**
   * @param {string} batchJobId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>} All rows for the job, in row-number order.
   */
  const findRowsByJobId = async (batchJobId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${ROW_COLUMNS} FROM batch_issuance_row WHERE batch_job_id = $1 ORDER BY row_number`,
      [batchJobId],
    );
    return rows;
  };

  /**
   * The rows of a job that were never finished — either never attempted, or
   * attempted but interrupted before an outcome was recorded (started_at
   * set, status still PENDING). Used to resume a stalled job from exactly
   * where it stopped, without touching rows already SUCCEEDED/FAILED.
   *
   * @param {string} batchJobId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>} Pending rows, in row-number order.
   */
  const findPendingRowsByJobId = async (batchJobId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${ROW_COLUMNS} FROM batch_issuance_row WHERE batch_job_id = $1 AND status = 'PENDING' ORDER BY row_number`,
      [batchJobId],
    );
    return rows;
  };

  /**
   * Jobs that stopped making progress — status still PENDING/PROCESSING but
   * not updated in over `thresholdSec` — for the worker's stalled-batch
   * sweep. Mirrors certificateRepo.findStalled's role for the certificate
   * pipeline: this is what lets a batch resume after the process that was
   * running it crashed or restarted, instead of sitting abandoned forever.
   *
   * @param {number} thresholdSec
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>}
   */
  const findStalledJobs = async (thresholdSec, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${JOB_COLUMNS} FROM batch_issuance_job
       WHERE status IN ('PENDING', 'PROCESSING')
         AND updated_at < now() - ($1 || ' seconds')::interval
       ORDER BY updated_at ASC`,
      [thresholdSec],
    );
    return rows;
  };

  return Object.freeze({
    createJob,
    insertRows,
    markRowDone,
    markRowStarted,
    incrementProgress,
    markJobCompleted,
    findJobById,
    findRowsByJobId,
    findPendingRowsByJobId,
    findStalledJobs,
  });
};
