/**
 * Raw parameterized SQL for `audit_log`. The `securecred_app` DB role only has
 * INSERT/SELECT on this table (no UPDATE/DELETE) — there is deliberately no
 * update/delete method here. Only repositories/ may import 'pg' (rule D3).
 */

const COLUMNS = 'audit_id, user_id, action, entity_type, entity_id, detail, created_at';

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {object} Frozen repository object.
 */
export const createAuditRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * Appends an immutable audit entry.
   *
   * @param {string|null} userId - Null for system/anonymous-triggered events.
   * @param {string} action - e.g. 'CERTIFICATE_ISSUED', 'REVOCATION_DENIED_CROSS_INSTITUTION'.
   * @param {string} entityType - e.g. 'certificate'.
   * @param {string} entityId
   * @param {object} [detail]
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The inserted row.
   */
  const append = async (userId, action, entityType, entityId, detail = {}, client) => {
    const { rows } = await exec(client).query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${COLUMNS}`,
      [userId, action, entityType, entityId, detail],
    );
    return rows[0];
  };

  /**
   * @param {string} institutionId
   * @param {object} [opts]
   * @param {number} [opts.limit=100]
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>}
   */
  const listForInstitution = async (institutionId, opts = {}, client) => {
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const { rows } = await exec(client).query(
      `SELECT a.audit_id, a.user_id, a.action, a.entity_type, a.entity_id, a.detail, a.created_at
       FROM audit_log a
       JOIN user_account ua ON ua.user_id = a.user_id
       WHERE ua.institution_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2`,
      [institutionId, limit],
    );
    return rows;
  };

  return Object.freeze({ append, listForInstitution });
};
