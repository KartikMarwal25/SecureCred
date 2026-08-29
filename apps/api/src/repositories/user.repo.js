/**
 * Raw parameterized SQL for `user_account` (and read-joins into `role`/`student`).
 * Only repositories/ may import 'pg' (rule D3).
 */

const COLUMNS = 'user_id, role_id, institution_id, clerk_user_id, full_name, email, account_status, created_at, updated_at';

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {object} Frozen repository object.
 */
export const createUserRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * Idempotent upsert keyed on `clerk_user_id`, invoked from the Clerk webhook.
   *
   * @param {string} clerkUserId
   * @param {string} fullName
   * @param {string} email
   * @param {string} roleName - ROLE.INSTITUTION | ROLE.STUDENT
   * @param {string|null} institutionId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object>} The upserted row.
   */
  const upsertFromClerk = async (clerkUserId, fullName, email, roleName, institutionId, client) => {
    const { rows } = await exec(client).query(
      `INSERT INTO user_account (role_id, institution_id, clerk_user_id, full_name, email, account_status)
       VALUES ((SELECT role_id FROM role WHERE role_name = $4), $5, $1, $2, $3, 'ACTIVE')
       ON CONFLICT (clerk_user_id) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             email = EXCLUDED.email,
             institution_id = EXCLUDED.institution_id,
             updated_at = now()
       RETURNING ${COLUMNS}`,
      [clerkUserId, fullName, email, roleName, institutionId ?? null],
    );
    return rows[0];
  };

  /**
   * @param {string} clerkUserId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>}
   */
  const findByClerkId = async (clerkUserId, client) => {
    const { rows } = await exec(client).query(
      `SELECT ${COLUMNS} FROM user_account WHERE clerk_user_id = $1`,
      [clerkUserId],
    );
    return rows[0];
  };

  /**
   * Resolves the authorization scope for a given user_account id: role name,
   * institution id (if institutional actor), and student id (if a student).
   *
   * @param {string} userId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<{role: string, institutionId: string|null, studentId: string|null}|undefined>}
   */
  const findScopeForSubject = async (userId, client) => {
    const { rows } = await exec(client).query(
      `SELECT r.role_name AS role, ua.institution_id, s.student_id
       FROM user_account ua
       JOIN role r ON r.role_id = ua.role_id
       LEFT JOIN student s ON s.user_id = ua.user_id
       WHERE ua.user_id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return { role: row.role, institutionId: row.institution_id, studentId: row.student_id };
  };

  /**
   * @param {string} userId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<object|undefined>} The student row.
   */
  const findStudentByUserId = async (userId, client) => {
    const { rows } = await exec(client).query(
      `SELECT student_id, user_id, institution_id, enrollment_number, course, graduation_year
       FROM student WHERE user_id = $1`,
      [userId],
    );
    return rows[0];
  };

  /**
   * Resolves a student within a specific institution by enrollment number —
   * how issuanceService.js turns an issuance request's `enrollmentNumber`
   * into a `student_id` to attach the new certificate to (BR: "holder must
   * be resolvable"). Institution scope is always in the WHERE clause.
   *
   * @param {string} institutionId
   * @param {string} enrollmentNumber
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<{studentId: string, userId: string, fullName: string, email: string}|undefined>}
   */
  const findStudentByEnrollment = async (institutionId, enrollmentNumber, client) => {
    const { rows } = await exec(client).query(
      `SELECT s.student_id, s.user_id, ua.full_name, ua.email
       FROM student s
       JOIN user_account ua ON ua.user_id = s.user_id
       WHERE s.institution_id = $1 AND s.enrollment_number = $2`,
      [institutionId, enrollmentNumber],
    );
    if (!rows[0]) return undefined;
    return { studentId: rows[0].student_id, userId: rows[0].user_id, fullName: rows[0].full_name, email: rows[0].email };
  };

  return Object.freeze({ upsertFromClerk, findByClerkId, findScopeForSubject, findStudentByUserId, findStudentByEnrollment });
};
