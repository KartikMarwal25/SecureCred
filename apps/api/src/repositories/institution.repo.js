/**
 * Raw parameterized SQL for the `institution` table. Not called out by name
 * in the original module inventory, but required by issuanceService.js to
 * resolve an institution's code/name (needed for certificate-number
 * allocation and the PDF header) from `actor.institutionId` alone — the
 * verified auth token only carries an id, never a display name. Only
 * repositories/ may import 'pg' (rule D3).
 */

const COLUMNS = 'institution_id, institution_name, institution_code, email, status, issuer_address, created_at';

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {object} Frozen repository object.
 */
export const createInstitutionRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * @param {string} institutionId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>}
   */
  const findById = async (institutionId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM institution WHERE institution_id = $1`,
      [institutionId],
    );
    return rows[0];
  };

  return Object.freeze({ findById });
};
