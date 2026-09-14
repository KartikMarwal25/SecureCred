/**
 * Raw parameterized SQL for `user_account` (and read-joins into `role`/`student`).
 * Only repositories/ may import 'pg' (rule D3).
 */
import { AppError } from '../lib/errors.js';
import { ERROR_CODE } from '@securecred/shared';

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

  /**
   * Idempotent upsert keyed on `email`, invoked from `requireAuth` for a
   * real (non-dev) Clerk user whose `clerk_user_id` has no DB row yet — this
   * makes account provisioning independent of webhook delivery timing (a
   * webhook may be delayed, or unreachable during local development without
   * a public URL). Self-registration always defaults to the student role;
   * institution accounts are provisioned out-of-band (see db/seeds/seed.js
   * for the shape of that scripted step), matching the SRS's "no admin
   * console" scope decision.
   *
   * If a placeholder row already exists for this email (an institution
   * issued a certificate to this person before they ever signed up — see
   * `resolveOrCreateStudentForIssuance` below), this LINKS the real Clerk
   * identity onto that existing row instead of creating a duplicate, which
   * is exactly why `email` (not `clerk_user_id`) is the lookup key here.
   *
   * @param {string} clerkUserId
   * @param {string} email
   * @param {string} fullName
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<void>}
   */
  const provisionOrLinkSelfServiceUser = async (clerkUserId, email, fullName, client) => {
    const c = exec(client);
    const existing = await c.query('SELECT user_id, clerk_user_id FROM user_account WHERE email = $1', [email]);
    if (existing.rows[0]) {
      if (existing.rows[0].clerk_user_id !== clerkUserId) {
        await c.query(
          `UPDATE user_account SET clerk_user_id = $1, full_name = $2, updated_at = now() WHERE user_id = $3`,
          [clerkUserId, fullName, existing.rows[0].user_id],
        );
      }
      return;
    }
    await c.query(
      `INSERT INTO user_account (role_id, institution_id, clerk_user_id, full_name, email, account_status)
       VALUES ((SELECT role_id FROM role WHERE role_name = 'student'), NULL, $1, $2, $3, 'ACTIVE')
       ON CONFLICT (clerk_user_id) DO NOTHING`,
      [clerkUserId, fullName, email],
    );
  };

  /**
   * Grants the institution role to a signed-in user who just chose
   * "institution" during role selection (see routes/auth.routes.js), keyed
   * on email the same way provisionOrLinkSelfServiceUser is — if a row
   * already exists for this email (e.g. they were previously a bare
   * self-registered student, or a placeholder from an issuance), it's
   * upgraded in place rather than duplicated.
   *
   * @param {string} clerkUserId
   * @param {string} email
   * @param {string} fullName
   * @param {string} institutionId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<void>}
   */
  const provisionInstitutionSelfService = async (clerkUserId, email, fullName, institutionId, client) => {
    const c = exec(client);
    const existing = await c.query('SELECT user_id FROM user_account WHERE email = $1', [email]);
    if (existing.rows[0]) {
      await c.query(
        `UPDATE user_account
         SET clerk_user_id = $1, full_name = $2, institution_id = $3,
             role_id = (SELECT role_id FROM role WHERE role_name = 'institution'),
             updated_at = now()
         WHERE user_id = $4`,
        [clerkUserId, fullName, institutionId, existing.rows[0].user_id],
      );
      return;
    }
    await c.query(
      `INSERT INTO user_account (role_id, institution_id, clerk_user_id, full_name, email, account_status)
       VALUES ((SELECT role_id FROM role WHERE role_name = 'institution'), $2, $1, $3, $4, 'ACTIVE')
       ON CONFLICT (clerk_user_id) DO NOTHING`,
      [clerkUserId, institutionId, fullName, email],
    );
  };

  /**
   * Resolves the `student` row an issuance should attach to, auto-provisioning
   * one when this is the first certificate ever issued to this person — the
   * only way a `student` row (and, if needed, its `user_account`) comes into
   * existence in this system, since there is no self-service "become a
   * student at institution X" flow (a student's institution is only known
   * once an institution actually issues them something). Precedence:
   *   1. An existing student at THIS institution matching enrollmentNumber
   *      (a returning holder) — reused as-is.
   *   2. A user_account already exists for holderEmail with no student row
   *      yet (either self-registered via Clerk, or a placeholder from a
   *      previous issuance attempt that failed after this step) — a new
   *      student row is created for THIS institution and linked to it.
   *   3. Nothing exists for that email — both a placeholder user_account
   *      (clerk_user_id = `pending:<email>`, linked later by
   *      provisionOrLinkSelfServiceUser when they actually sign up) and a
   *      new student row are created together.
   * Throws E_VALIDATION if the email already belongs to a student at a
   * DIFFERENT institution — this schema supports one student affiliation
   * per person, so that is a genuine conflict, not something to silently
   * paper over.
   *
   * @param {object} params
   * @param {string} params.institutionId
   * @param {string} params.enrollmentNumber
   * @param {string} params.holderEmail
   * @param {string} params.holderName
   * @param {string} [params.course]
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<{studentId: string, userId: string, fullName: string, email: string}>}
   * @throws {AppError} E_VALIDATION if holderEmail is already a student elsewhere.
   */
  const resolveOrCreateStudentForIssuance = async (params, client) => {
    const { institutionId, enrollmentNumber, holderEmail, holderName, course } = params;
    const c = exec(client);

    const byEnrollment = await findStudentByEnrollment(institutionId, enrollmentNumber, client);
    if (byEnrollment) return byEnrollment;

    const byEmail = await c.query(
      `SELECT ua.user_id, ua.full_name, ua.email, s.student_id, s.institution_id AS student_institution_id
       FROM user_account ua
       LEFT JOIN student s ON s.user_id = ua.user_id
       WHERE ua.email = $1`,
      [holderEmail],
    );

    if (byEmail.rows[0]?.student_id) {
      if (byEmail.rows[0].student_institution_id !== institutionId) {
        throw new AppError(
          ERROR_CODE.E_VALIDATION,
          'This email address is already registered as a student at a different institution.',
          { fields: [{ path: 'holderEmail', message: 'Already registered at a different institution.' }] },
        );
      }
      return {
        studentId: byEmail.rows[0].student_id,
        userId: byEmail.rows[0].user_id,
        fullName: byEmail.rows[0].full_name,
        email: byEmail.rows[0].email,
      };
    }

    let userId = byEmail.rows[0]?.user_id;
    if (!userId) {
      const inserted = await c.query(
        `INSERT INTO user_account (role_id, institution_id, clerk_user_id, full_name, email, account_status)
         VALUES ((SELECT role_id FROM role WHERE role_name = 'student'), NULL, $1, $2, $3, 'ACTIVE')
         RETURNING user_id`,
        [`pending:${holderEmail}`, holderName, holderEmail],
      );
      userId = inserted.rows[0].user_id;
    }

    const studentInsert = await c.query(
      `INSERT INTO student (user_id, institution_id, enrollment_number, course)
       VALUES ($1, $2, $3, $4)
       RETURNING student_id`,
      [userId, institutionId, enrollmentNumber, course ?? null],
    );

    return { studentId: studentInsert.rows[0].student_id, userId, fullName: holderName, email: holderEmail };
  };

  /**
   * Detaches an institution staff member from their institution without
   * deleting their account — self-service fix for "typed the wrong
   * institution code and got attached to (or accidentally created) the
   * wrong one." Deliberately keeps `role_id` as institution and the
   * `user_account` row itself intact (a hard delete would violate the
   * RESTRICT foreign keys from `certificate.issued_by`/`revocation.
   * revoked_by` for anyone who's already done real work) — only
   * `institution_id` is cleared. See auth.routes.js's `/choose-role` guard
   * for how a detached account is allowed to pick an institution again.
   *
   * @param {string} userId
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<void>}
   */
  const leaveInstitution = async (userId, client) => {
    await exec(client).query('UPDATE user_account SET institution_id = NULL, updated_at = now() WHERE user_id = $1', [
      userId,
    ]);
  };

  return Object.freeze({
    upsertFromClerk,
    findByClerkId,
    findScopeForSubject,
    findStudentByUserId,
    findStudentByEnrollment,
    provisionOrLinkSelfServiceUser,
    provisionInstitutionSelfService,
    resolveOrCreateStudentForIssuance,
    leaveInstitution,
  });
};
