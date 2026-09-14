/**
 * All raw, parameterized SQL for the `certificate` table. This file (and the
 * rest of repositories/) is the only place in the codebase permitted to
 * import 'pg' (rule D3). Every query spells out its columns (never `SELECT *`)
 * and keeps tenant/institution scope in the WHERE clause, never filtered
 * client-side after the fact.
 */

const FULL_COLUMNS = `
  certificate_id, student_id, institution_id, issued_by, certificate_number,
  title, certificate_type, issue_date, attributes, certificate_hash,
  template_version, blockchain_cert_id, status, failure_cause,
  reconcile_attempts, last_chain_check_at, last_confirmed_chain_state,
  created_at, updated_at
`;

/**
 * Same columns as FULL_COLUMNS (table-qualified) plus the holder's display
 * name/email, joined in from student -> user_account. Used only by the two
 * queries that render a certificate for an institution/student to look at
 * (`findById`, `listByInstitution`) — never for the public verifier
 * projection, which has no business showing a holder's name to an anonymous
 * caller.
 */
const FULL_COLUMNS_WITH_HOLDER = `
  c.certificate_id, c.student_id, c.institution_id, c.issued_by, c.certificate_number,
  c.title, c.certificate_type, c.issue_date, c.attributes, c.certificate_hash,
  c.template_version, c.blockchain_cert_id, c.status, c.failure_cause,
  c.reconcile_attempts, c.last_chain_check_at, c.last_confirmed_chain_state,
  c.created_at, c.updated_at, u.full_name AS holder_name, u.email AS holder_email
`;
const HOLDER_JOIN = `
  JOIN student s ON s.student_id = c.student_id
  JOIN user_account u ON u.user_id = s.user_id
`;

/**
 * Columns safe to hand to an anonymous public verifier (no internal ops
 * fields). Includes the holder's display name and the institution's name —
 * the `/document` endpoint already serves the full PDF (which prints both)
 * to the same anonymous caller for the same certificate number, so
 * withholding them from this JSON view added a click of friction without
 * any real privacy benefit.
 */
const PUBLIC_COLUMNS = `
  c.certificate_id, c.certificate_number, c.title, c.certificate_type, c.issue_date,
  c.institution_id, c.student_id, c.certificate_hash, c.template_version,
  c.blockchain_cert_id, c.status, c.last_chain_check_at, c.last_confirmed_chain_state,
  c.created_at, u.full_name AS holder_name, i.institution_name AS institution_name
`;

/** Allow-list of columns `updateStatus` is permitted to set alongside `status`. */
const UPDATABLE_EXTRA_COLUMNS = new Set([
  'failure_cause',
  'blockchain_cert_id',
  'template_version',
  'reconcile_attempts',
]);

const TRANSIENT_STATUSES = ['PENDING_STORAGE', 'PENDING_ANCHOR', 'ANCHORING', 'REVOKING'];

/**
 * Creates the certificate repository.
 *
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool - The pg connection pool.
 * @returns {object} Frozen repository object.
 */
export const createCertificateRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * Inserts a new certificate row in PENDING_STORAGE, the first step of the
   * persist-before-external-call issuance pipeline.
   *
   * @param {object} data
   * @param {string} data.studentId
   * @param {string} data.institutionId
   * @param {string} data.issuedBy - user_account.user_id of the issuing actor.
   * @param {string} data.certificateNumber
   * @param {string} data.title
   * @param {string} data.certificateType
   * @param {string} data.issueDate - ISO date string.
   * @param {object} data.attributes
   * @param {string} data.certificateHash - 64-char hex SHA-256 digest.
   * @param {number} data.templateVersion
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The inserted row.
   */
  const insertPending = async (data, client) => {
    const { rows } = await exec(client).query(
      `INSERT INTO certificate (
         student_id, institution_id, issued_by, certificate_number, title,
         certificate_type, issue_date, attributes, certificate_hash,
         template_version, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING_STORAGE')
       RETURNING ${FULL_COLUMNS}`,
      [
        data.studentId,
        data.institutionId,
        data.issuedBy,
        data.certificateNumber,
        data.title,
        data.certificateType,
        data.issueDate,
        data.attributes ?? {},
        data.certificateHash,
        data.templateVersion,
      ],
    );
    return rows[0];
  };

  /**
   * @param {string} certificateId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The full row, or undefined if not found.
   */
  const findById = async (certificateId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${FULL_COLUMNS_WITH_HOLDER} FROM certificate c ${HOLDER_JOIN} WHERE c.certificate_id = $1`,
      [certificateId],
    );
    return rows[0];
  };

  /**
   * Everything the institution/student-facing certificate detail screen
   * renders in one read: holder, institution name, the staff member who
   * issued it, the current IPFS reference, the latest ISSUE/REVOKE
   * transaction hashes + confirmed block number, and the revocation record
   * (reason, timestamp, who revoked it) if one exists. One query, several
   * LEFT JOINs (including LATERAL "most recent row" joins) rather than N+1
   * round trips through the other single-table repositories.
   *
   * @param {string} certificateId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>}
   */
  const findDetailById = async (certificateId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${FULL_COLUMNS_WITH_HOLDER},
              inst.institution_name,
              issuer.full_name AS issued_by_name,
              cf.ipfs_cid,
              issue_tx.transaction_hash AS issue_tx_hash,
              issue_tx.block_number AS issue_block_number,
              revoke_tx.transaction_hash AS revoke_tx_hash,
              rv.reason AS revocation_reason,
              rv.revoked_at AS revocation_revoked_at,
              revoker.full_name AS revoked_by_name
       FROM certificate c
       ${HOLDER_JOIN}
       LEFT JOIN institution inst ON inst.institution_id = c.institution_id
       LEFT JOIN user_account issuer ON issuer.user_id = c.issued_by
       LEFT JOIN LATERAL (
         SELECT ipfs_cid FROM certificate_file
         WHERE certificate_id = c.certificate_id
         ORDER BY uploaded_at DESC LIMIT 1
       ) cf ON true
       LEFT JOIN LATERAL (
         SELECT transaction_hash, block_number FROM blockchain_transaction
         WHERE certificate_id = c.certificate_id AND transaction_type = 'ISSUE'
         ORDER BY timestamp DESC LIMIT 1
       ) issue_tx ON true
       LEFT JOIN LATERAL (
         SELECT transaction_hash FROM blockchain_transaction
         WHERE certificate_id = c.certificate_id AND transaction_type = 'REVOKE'
         ORDER BY timestamp DESC LIMIT 1
       ) revoke_tx ON true
       LEFT JOIN revocation rv ON rv.certificate_id = c.certificate_id
       LEFT JOIN user_account revoker ON revoker.user_id = rv.revoked_by
       WHERE c.certificate_id = $1`,
      [certificateId],
    );
    return rows[0];
  };

  /**
   * @param {string} certificateHash
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The full row, or undefined if not found.
   */
  const findByHash = async (certificateHash, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${FULL_COLUMNS} FROM certificate WHERE certificate_hash = $1`,
      [certificateHash],
    );
    return rows[0];
  };

  /**
   * Public-safe projection used by the anonymous verification/document endpoints.
   *
   * @param {string} certificateNumber
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>}
   */
  const findByCertificateNumber = async (certificateNumber, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${PUBLIC_COLUMNS} FROM certificate c
       JOIN student s ON s.student_id = c.student_id
       JOIN user_account u ON u.user_id = s.user_id
       JOIN institution i ON i.institution_id = c.institution_id
       WHERE c.certificate_number = $1`,
      [certificateNumber],
    );
    return rows[0];
  };

  /**
   * Keyset-paginated listing scoped to a single institution.
   *
   * @param {object} params
   * @param {string} params.institutionId
   * @param {string} [params.cursor] - Opaque base64 cursor from a previous page.
   * @param {number} [params.limit=20]
   * @param {string} [params.status]
   * @param {string} [params.q] - Free-text match against title/certificate_number.
   * @param {string} [params.from] - Issue-date lower bound (inclusive), ISO date.
   * @param {string} [params.to] - Issue-date upper bound (inclusive), ISO date.
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<{items: object[], nextCursor: string|null}>}
   */
  const listByInstitution = async (params, client) => {
    const { institutionId, cursor, limit = 20, status, q, from, to } = params;
    const conditions = ['c.institution_id = $1'];
    const values = [institutionId];

    if (cursor) {
      let decoded;
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      } catch {
        decoded = null;
      }
      if (decoded?.createdAt && decoded?.certificateId) {
        values.push(decoded.createdAt, decoded.certificateId);
        conditions.push(`(c.created_at, c.certificate_id) < ($${values.length - 1}, $${values.length})`);
      }
    }
    if (status) {
      values.push(status);
      conditions.push(`c.status = $${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      conditions.push(
        `(c.title ILIKE $${values.length} OR c.certificate_number ILIKE $${values.length} OR u.full_name ILIKE $${values.length})`,
      );
    }
    if (from) {
      values.push(from);
      conditions.push(`c.issue_date >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      conditions.push(`c.issue_date <= $${values.length}`);
    }

    const fetchLimit = Math.max(1, Math.min(100, limit));
    values.push(fetchLimit + 1);

    const { rows } = await exec(client).query(
      `SELECT ${FULL_COLUMNS_WITH_HOLDER} FROM certificate c
       ${HOLDER_JOIN}
       WHERE ${conditions.join(' AND ')}
       ORDER BY c.created_at DESC, c.certificate_id DESC
       LIMIT $${values.length}`,
      values,
    );

    const hasMore = rows.length > fetchLimit;
    const items = hasMore ? rows.slice(0, fetchLimit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ createdAt: last.created_at, certificateId: last.certificate_id }), 'utf8').toString('base64url')
      : null;

    return { items, nextCursor };
  };

  /**
   * Lists a student's own certificates. Only ACTIVE/REVOKED are ever visible
   * to the holder — transient/failed states stay invisible until resolved.
   *
   * @param {string} userId - user_account.user_id of the authenticated student.
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>}
   */
  const listByHolderUserId = async (userId, client) => {
    const { rows } = await exec(client).query(
      `SELECT c.certificate_id, c.certificate_number, c.title, c.certificate_type,
              c.issue_date, c.institution_id, c.status, c.certificate_hash,
              c.blockchain_cert_id, c.created_at, c.updated_at,
              inst.institution_name,
              rv.reason AS revocation_reason, rv.revoked_at AS revocation_revoked_at
       FROM certificate c
       JOIN student s ON s.student_id = c.student_id
       LEFT JOIN institution inst ON inst.institution_id = c.institution_id
       LEFT JOIN revocation rv ON rv.certificate_id = c.certificate_id
       WHERE s.user_id = $1 AND c.status IN ('ACTIVE', 'REVOKING', 'REVOKED')
       ORDER BY c.created_at DESC`,
      [userId],
    );
    return rows;
  };

  /**
   * Compare-and-set status transition. The ONLY intended caller is
   * lifecycleService.js — see its module comment.
   *
   * @param {string} certificateId
   * @param {string} from - Required current status.
   * @param {string} to - New status.
   * @param {object} [extra] - Additional columns to set, keys from UPDATABLE_EXTRA_COLUMNS only.
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The updated row, or undefined if the compare-and-set missed (lost race / wrong state).
   */
  const updateStatus = async (certificateId, from, to, extra = {}, client) => {
    const setClauses = ['status = $1', 'updated_at = now()'];
    const values = [to];

    for (const [key, value] of Object.entries(extra)) {
      if (!UPDATABLE_EXTRA_COLUMNS.has(key)) {
        throw new Error(`updateStatus: column "${key}" is not in the update allow-list`);
      }
      values.push(value);
      setClauses.push(`${key} = $${values.length}`);
    }

    values.push(certificateId, from);
    const { rows } = await exec(client).query(
      `UPDATE certificate SET ${setClauses.join(', ')}
       WHERE certificate_id = $${values.length - 1} AND status = $${values.length}
       RETURNING ${FULL_COLUMNS}`,
      values,
    );
    return rows[0];
  };

  /**
   * Finds certificates stuck in a transient state past the stall threshold,
   * for the worker's reconciler sweep.
   *
   * @param {number} thresholdSec
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>}
   */
  const findStalled = async (thresholdSec, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${FULL_COLUMNS} FROM certificate
       WHERE status = ANY($1::text[])
         AND updated_at < now() - ($2 || ' seconds')::interval
       ORDER BY updated_at ASC`,
      [TRANSIENT_STATUSES, thresholdSec],
    );
    return rows;
  };

  /**
   * Records the last confirmed on-chain view of a certificate, used as the
   * degraded-mode fallback when a live RPC call fails.
   *
   * @param {string} certificateId
   * @param {object} chainState - JSON-serializable snapshot (isIssued, isRevoked, etc).
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<void>}
   */
  const recordChainState = async (certificateId, chainState, client) => {
    await exec(client).query(
      `UPDATE certificate SET last_confirmed_chain_state = $2, last_chain_check_at = now()
       WHERE certificate_id = $1`,
      [certificateId, chainState],
    );
  };

  /**
   * Increments `reconcile_attempts` by 1 without touching `status` — used by
   * the worker's reconciler to track retry counts across sweeps. This is
   * deliberately NOT a status change, so it does not go through
   * lifecycleService (rule D5 only governs the `status` column itself).
   *
   * @param {string} certificateId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The updated row.
   */
  const bumpReconcileAttempts = async (certificateId, client) => {
    const { rows } = await exec(client).query(
      `UPDATE certificate SET reconcile_attempts = reconcile_attempts + 1, updated_at = now()
       WHERE certificate_id = $1
       RETURNING ${FULL_COLUMNS}`,
      [certificateId],
    );
    return rows[0];
  };

  return Object.freeze({
    insertPending,
    findById,
    findDetailById,
    findByHash,
    findByCertificateNumber,
    listByInstitution,
    listByHolderUserId,
    updateStatus,
    findStalled,
    recordChainState,
    bumpReconcileAttempts,
  });
};
