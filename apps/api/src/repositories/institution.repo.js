/**
 * Raw parameterized SQL for the `institution` table. Not called out by name
 * in the original module inventory, but required by issuanceService.js to
 * resolve an institution's code/name (needed for certificate-number
 * allocation and the PDF header) from `actor.institutionId` alone — the
 * verified auth token only carries an id, never a display name. Only
 * repositories/ may import 'pg' (rule D3).
 */

import crypto from 'node:crypto';

const COLUMNS =
  'institution_id, institution_name, institution_code, email, status, issuer_address, access_code, created_at';

/** 12 uppercase hex chars — shared secret staff must supply to self-register for this institution. */
const generateAccessCode = () => crypto.randomBytes(6).toString('hex').toUpperCase();

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

  /**
   * @param {string} institutionCode
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>}
   */
  const findByCode = async (institutionCode, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM institution WHERE institution_code = $1`,
      [institutionCode],
    );
    return rows[0];
  };

  /**
   * Creates a new institution row — used by the self-service "sign up as an
   * institution" flow (see userRepo.provisionInstitutionSelfService) when no
   * institution with the given code exists yet. Generates a fresh
   * `access_code` (returned on the row) — the shared secret any further
   * staff self-registering for this same institution must supply.
   *
   * @param {{institutionName: string, institutionCode: string, email: string}} data
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The inserted row, including the generated `access_code`.
   */
  const create = async ({ institutionName, institutionCode, email }, client) => {
    const { rows } = await exec(client).query(
      `INSERT INTO institution (institution_name, institution_code, email, status, access_code)
       VALUES ($1, $2, $3, 'ACTIVE', $4)
       RETURNING ${COLUMNS}`,
      [institutionName, institutionCode, email, generateAccessCode()],
    );
    return rows[0];
  };

  /**
   * The institution with the most ACTIVE certificates issued — used only for
   * the public landing page's "real registered issuer" showcase card.
   * Deliberately returns institution-level aggregate info only (name + a
   * count), never anything about a specific certificate or its holder, so
   * this can't become a way to broadcast someone's credential to every
   * visitor without their knowledge.
   *
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<{institutionName: string, certificateCount: number}|undefined>}
   */
  const findShowcase = async (client) => {
    const { rows } = await exec(client).query(
      `SELECT i.institution_name, COUNT(c.certificate_id) FILTER (WHERE c.status = 'ACTIVE') AS certificate_count
       FROM institution i
       LEFT JOIN certificate c ON c.institution_id = i.institution_id
       GROUP BY i.institution_id
       ORDER BY certificate_count DESC, i.created_at ASC
       LIMIT 1`,
    );
    if (!rows[0]) return undefined;
    return { institutionName: rows[0].institution_name, certificateCount: Number(rows[0].certificate_count) };
  };

  /**
   * Generates a fresh `access_code` and overwrites the institution's current
   * one — the old code stops working immediately. Any authenticated staff
   * member of the institution may call this (see institutions.routes.js);
   * there is no separate "owner"/admin tier in this schema, so it's trusted
   * at the same level as everything else a staff member can already do
   * (issue, revoke). Callable by any existing staff member specifically so
   * the flow can never lock an institution out of its own account.
   *
   * @param {string} institutionId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<string>} The new access code.
   */
  const rotateAccessCode = async (institutionId, client) => {
    const newCode = generateAccessCode();
    await exec(client).query('UPDATE institution SET access_code = $1 WHERE institution_id = $2', [
      newCode,
      institutionId,
    ]);
    return newCode;
  };

  return Object.freeze({ findById, findByCode, create, findShowcase, rotateAccessCode });
};
