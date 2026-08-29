/**
 * Raw parameterized SQL for the `blockchain_transaction` table. Only
 * repositories/ may import 'pg' (rule D3).
 */

const COLUMNS = `
  transaction_id, certificate_id, transaction_hash, transaction_type, network,
  contract_address, transaction_status, block_number, confirmations, gas_used,
  revert_reason, nonce, timestamp
`;

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {object} Frozen repository object.
 */
export const createTxRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * Inserts a new PENDING blockchain transaction record.
   *
   * @param {object} data
   * @param {string} data.certificateId
   * @param {string} data.transactionHash
   * @param {string} data.transactionType - TRANSACTION_TYPE.ISSUE | .REVOKE
   * @param {string} data.network
   * @param {string} data.contractAddress
   * @param {number} [data.nonce]
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The inserted row.
   */
  const insert = async (data, client) => {
    const { rows } = await exec(client).query(
      `INSERT INTO blockchain_transaction (
         certificate_id, transaction_hash, transaction_type, network,
         contract_address, transaction_status, nonce
       ) VALUES ($1,$2,$3,$4,$5,'PENDING',$6)
       RETURNING ${COLUMNS}`,
      [data.certificateId, data.transactionHash, data.transactionType, data.network, data.contractAddress, data.nonce ?? null],
    );
    return rows[0];
  };

  /**
   * Marks a transaction CONFIRMED with its receipt details.
   *
   * @param {string} transactionHash
   * @param {number} blockNumber
   * @param {number} confirmations
   * @param {string|number} [gasUsed]
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The updated row.
   */
  const markConfirmed = async (transactionHash, blockNumber, confirmations, gasUsed, client) => {
    const { rows } = await exec(client).query(
      `UPDATE blockchain_transaction
       SET transaction_status = 'CONFIRMED', block_number = $2, confirmations = $3, gas_used = $4
       WHERE transaction_hash = $1
       RETURNING ${COLUMNS}`,
      [transactionHash, blockNumber, confirmations, gasUsed ?? null],
    );
    return rows[0];
  };

  /**
   * Marks a transaction FAILED with a revert reason.
   *
   * @param {string} transactionHash
   * @param {string} revertReason
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The updated row.
   */
  const markFailed = async (transactionHash, revertReason, client) => {
    const { rows } = await exec(client).query(
      `UPDATE blockchain_transaction
       SET transaction_status = 'FAILED', revert_reason = $2
       WHERE transaction_hash = $1
       RETURNING ${COLUMNS}`,
      [transactionHash, revertReason],
    );
    return rows[0];
  };

  /**
   * @param {string} transactionHash
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>}
   */
  const findByHash = async (transactionHash, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM blockchain_transaction WHERE transaction_hash = $1`,
      [transactionHash],
    );
    return rows[0];
  };

  /**
   * @param {string} certificateId
   * @param {string} transactionType - TRANSACTION_TYPE.ISSUE | .REVOKE
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The most recent transaction of that type for the certificate.
   */
  const findLatestForCertificate = async (certificateId, transactionType, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM blockchain_transaction
       WHERE certificate_id = $1 AND transaction_type = $2
       ORDER BY timestamp DESC LIMIT 1`,
      [certificateId, transactionType],
    );
    return rows[0];
  };

  /**
   * @param {number} seconds
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>} PENDING transactions older than `seconds`.
   */
  const findPendingOlderThan = async (seconds, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM blockchain_transaction
       WHERE transaction_status = 'PENDING' AND timestamp < now() - ($1 || ' seconds')::interval
       ORDER BY timestamp ASC`,
      [seconds],
    );
    return rows;
  };

  return Object.freeze({ insert, markConfirmed, markFailed, findByHash, findLatestForCertificate, findPendingOlderThan });
};
