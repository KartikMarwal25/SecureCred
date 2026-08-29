/**
 * Raw parameterized SQL for the `revocation` table. There is no delete and no
 * un-revoke path anywhere — this repo exposes insert/read/attach only.
 * Only repositories/ may import 'pg' (rule D3).
 */

const COLUMNS = 'revocation_id, certificate_id, revoked_by, blockchain_tx_id, reason, revoked_at';

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {object} Frozen repository object.
 */
export const createRevocationRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * @param {string} certificateId
   * @param {string} revokedBy - user_account.user_id of the actor who revoked.
   * @param {string} reason
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The inserted row.
   */
  const insert = async (certificateId, revokedBy, reason, client) => {
    const { rows } = await exec(client).query(
      `INSERT INTO revocation (certificate_id, revoked_by, reason)
       VALUES ($1,$2,$3)
       RETURNING ${COLUMNS}`,
      [certificateId, revokedBy, reason],
    );
    return rows[0];
  };

  /**
   * @param {string} certificateId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>}
   */
  const findByCertificateId = async (certificateId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM revocation WHERE certificate_id = $1`,
      [certificateId],
    );
    return rows[0];
  };

  /**
   * Links a revocation record to the blockchain transaction that carried it.
   *
   * @param {string} revocationId
   * @param {string} transactionId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The updated row.
   */
  const attachTransaction = async (revocationId, transactionId, client) => {
    const { rows } = await exec(client).query(
      `UPDATE revocation SET blockchain_tx_id = $2 WHERE revocation_id = $1 RETURNING ${COLUMNS}`,
      [revocationId, transactionId],
    );
    return rows[0];
  };

  return Object.freeze({ insert, findByCertificateId, attachTransaction });
};
