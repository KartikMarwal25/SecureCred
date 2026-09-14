/**
 * Raw parameterized SQL for `institution_join_request` — the human-approval
 * gate that stands between "supplied a valid access code" and "actually has
 * institution staff privileges." Only repositories/ may import 'pg' (rule D3).
 */

const COLUMNS =
  'request_id, institution_id, clerk_user_id, email, full_name, status, requested_at, decided_at, decided_by';

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {object} Frozen repository object.
 */
export const createInstitutionJoinRequestRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * Creates a new PENDING request, or returns the existing one if this
   * person already has a live (pending) request for this institution — the
   * partial unique index enforces this at the database level; this just
   * makes re-submitting a no-op instead of a 500.
   *
   * @param {{institutionId: string, clerkUserId: string, email: string, fullName: string}} data
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The pending request row.
   */
  const create = async ({ institutionId, clerkUserId, email, fullName }, client) => {
    const c = exec(client);
    const existing = await c.query(
      `SELECT ${COLUMNS} FROM institution_join_request
       WHERE institution_id = $1 AND clerk_user_id = $2 AND status = 'PENDING'`,
      [institutionId, clerkUserId],
    );
    if (existing.rows[0]) return existing.rows[0];

    const { rows } = await c.query(
      `INSERT INTO institution_join_request (institution_id, clerk_user_id, email, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [institutionId, clerkUserId, email, fullName],
    );
    return rows[0];
  };

  /**
   * @param {string} clerkUserId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} This person's pending request, across any institution, if any.
   */
  const findPendingForClerkUser = async (clerkUserId, client) => {
    const { rows } = await exec(client).query(
      `SELECT r.request_id, r.institution_id, r.requested_at, i.institution_name
       FROM institution_join_request r
       JOIN institution i ON i.institution_id = r.institution_id
       WHERE r.clerk_user_id = $1 AND r.status = 'PENDING'
       ORDER BY r.requested_at DESC
       LIMIT 1`,
      [clerkUserId],
    );
    return rows[0];
  };

  /**
   * @param {string} institutionId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>} Every pending request for this institution, oldest first.
   */
  const findPendingForInstitution = async (institutionId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM institution_join_request
       WHERE institution_id = $1 AND status = 'PENDING'
       ORDER BY requested_at ASC`,
      [institutionId],
    );
    return rows;
  };

  /**
   * @param {string} requestId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>}
   */
  const findById = async (requestId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM institution_join_request WHERE request_id = $1`,
      [requestId],
    );
    return rows[0];
  };

  /**
   * @param {string} requestId
   * @param {'APPROVED'|'REJECTED'} status
   * @param {string} decidedByUserId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The updated row, only if it was still PENDING.
   */
  const decide = async (requestId, status, decidedByUserId, client) => {
    const { rows } = await exec(client).query(
      `UPDATE institution_join_request
       SET status = $2, decided_at = now(), decided_by = $3
       WHERE request_id = $1 AND status = 'PENDING'
       RETURNING ${COLUMNS}`,
      [requestId, status, decidedByUserId],
    );
    return rows[0];
  };

  return Object.freeze({ create, findPendingForClerkUser, findPendingForInstitution, findById, decide });
};
