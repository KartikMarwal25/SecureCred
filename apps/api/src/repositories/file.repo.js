/**
 * Raw parameterized SQL for the `certificate_file` table (IPFS-pinned artifacts
 * attached to a certificate). Only repositories/ may import 'pg' (rule D3).
 */

const COLUMNS = 'file_id, certificate_id, file_name, file_type, ipfs_cid, byte_size, uploaded_at';

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {object} Frozen repository object.
 */
export const createFileRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * Records a newly-pinned file against a certificate.
   *
   * @param {string} certificateId
   * @param {string} fileName
   * @param {string} fileType - e.g. 'application/pdf'.
   * @param {string} ipfsCid
   * @param {number} byteSize
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The inserted row.
   */
  const insert = async (certificateId, fileName, fileType, ipfsCid, byteSize, client) => {
    const { rows } = await exec(client).query(
      `INSERT INTO certificate_file (certificate_id, file_name, file_type, ipfs_cid, byte_size)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${COLUMNS}`,
      [certificateId, fileName, fileType, ipfsCid, byteSize],
    );
    return rows[0];
  };

  /**
   * @param {string} certificateId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object[]>}
   */
  const findByCertificateId = async (certificateId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM certificate_file WHERE certificate_id = $1 ORDER BY uploaded_at ASC`,
      [certificateId],
    );
    return rows;
  };

  return Object.freeze({ insert, findByCertificateId });
};
