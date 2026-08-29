/**
 * Raw parameterized SQL for `verification_log`. The `securecred_app` DB role
 * only has INSERT/SELECT here (no UPDATE/DELETE). `append` is fire-and-forget
 * from the caller's perspective: verification must never fail or slow down
 * because logging hiccuped, so every failure is caught and swallowed here
 * (logged, never thrown). Only repositories/ may import 'pg' (rule D3).
 */

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen repository object.
 */
export const createVerificationLogRepo = ({ pool, logger }) => {
  const exec = (client) => client ?? pool;

  /**
   * Records one verification attempt. Never throws — a logging failure must
   * never block or fail a verification response.
   *
   * @param {string|null} certificateId - Null when the certificate number didn't resolve to any row.
   * @param {string|null} verifierUserId - Null for anonymous verifiers.
   * @param {string} method - VERIFICATION_METHOD.*
   * @param {string} result - VERIFY_OUTCOME.*
   * @param {boolean} degraded - Whether this result came from a degraded (non-live) chain check.
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<void>}
   */
  const append = async (certificateId, verifierUserId, method, result, degraded, client) => {
    try {
      await exec(client).query(
        `INSERT INTO verification_log (certificate_id, verifier_user_id, verification_method, verification_result, degraded)
         VALUES ($1,$2,$3,$4,$5)`,
        [certificateId, verifierUserId, method, result, Boolean(degraded)],
      );
    } catch (err) {
      logger?.warn?.({ err }, 'verificationLog.repo: failed to append verification log entry (swallowed)');
    }
  };

  /**
   * Aggregates verification counts by outcome for an institution's certificates.
   *
   * @param {string} institutionId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<Array<{result: string, count: number}>>}
   */
  const aggregateForInstitution = async (institutionId, client) => {
    const { rows } = await exec(client).query(
      `SELECT vl.verification_result AS result, COUNT(*)::int AS count
       FROM verification_log vl
       JOIN certificate c ON c.certificate_id = vl.certificate_id
       WHERE c.institution_id = $1
       GROUP BY vl.verification_result`,
      [institutionId],
    );
    return rows;
  };

  /**
   * Daily verification counts for an institution over the trailing window,
   * oldest first. Days with zero verifications are omitted (the caller
   * renders "no verifications yet" rather than a zero-filled series).
   *
   * @param {string} institutionId
   * @param {number} [days=30]
   * @returns {Promise<Array<{date: string, count: number}>>}
   */
  const seriesByDayForInstitution = async (institutionId, days = 30) => {
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc('day', vl.verified_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
       FROM verification_log vl
       JOIN certificate c ON c.certificate_id = vl.certificate_id
       WHERE c.institution_id = $1 AND vl.verified_at >= now() - ($2 || ' days')::interval
       GROUP BY date
       ORDER BY date ASC`,
      [institutionId, days],
    );
    return rows;
  };

  /**
   * The institution's most-frequently-verified certificates.
   *
   * @param {string} institutionId
   * @param {number} [limit=5]
   * @returns {Promise<Array<{certificateNumber: string, title: string, count: number}>>}
   */
  const mostVerifiedForInstitution = async (institutionId, limit = 5) => {
    const { rows } = await pool.query(
      `SELECT c.certificate_number AS "certificateNumber", c.title AS title, COUNT(*)::int AS count
       FROM verification_log vl
       JOIN certificate c ON c.certificate_id = vl.certificate_id
       WHERE c.institution_id = $1
       GROUP BY c.certificate_id, c.certificate_number, c.title
       ORDER BY count DESC
       LIMIT $2`,
      [institutionId, limit],
    );
    return rows;
  };

  return Object.freeze({
    append,
    aggregateForInstitution,
    seriesByDayForInstitution,
    mostVerifiedForInstitution,
  });
};
