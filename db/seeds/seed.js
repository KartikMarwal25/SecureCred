#!/usr/bin/env node
// db/seeds/seed.js
//
// ***************************************************************************
// LOCAL DEVELOPMENT / DEMO SEED DATA ONLY. Do not run this against a shared
// staging or production database. It inserts a small, fixed set of demo rows
// (one institution, one institution-staff user, one student + student user)
// so the app has real accounts to sign in as locally. Deliberately does NOT
// seed any certificates — a seeded certificate row with no real chain
// anchor or pinned file behind it is unreachable/undownloadable by design,
// so it's better to issue a real one through the app than fake one here.
// ***************************************************************************
//
// Idempotent: safe to run more than once. Every insert either uses
// ON CONFLICT DO NOTHING keyed on the table's real unique constraint, or is
// preceded by a SELECT check, and in both cases we fall back to reading the
// existing row's id so downstream inserts (which need the parent id) still
// work on a second run.
//
// Usage:
//   node seed.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'ERROR: DATABASE_URL is not set. Set it in the environment or in a .env file at the repo root.'
    );
    process.exit(1);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Fixed demo data (deliberately not randomized, so reruns are idempotent and
// diffable). Hashes/cert numbers below are clearly-patterned fakes, not real
// certificate content.
// ---------------------------------------------------------------------------

// Fixed, well-known ids (not gen_random_uuid() defaults) so a fresh clone's
// demo data is byte-identical every time. The frontend's dev-mode auth
// (apps/web/src/auth/devAuth.js) references these same constants so a local
// "Sign in as institution/student" click maps to real rows that actually
// satisfy this schema's foreign keys, instead of a throwaway random id that
// would fail on the first write. Keep both files in sync if these ever change.
const INSTITUTION_ID = '00000000-0000-0000-0000-000000000001';
const INSTITUTION_STAFF_USER_ID = '00000000-0000-0000-0000-000000000002';
const STUDENT_USER_ID = '00000000-0000-0000-0000-000000000003';
const STUDENT_PROFILE_ID = '00000000-0000-0000-0000-000000000004';

const INSTITUTION = {
  institution_id: INSTITUTION_ID,
  institution_name: 'Swami Keshvanand Institute of Technology, Management & Gramothan',
  institution_code: 'SKIT',
  email: 'registrar@skit.ac.in',
  status: 'ACTIVE',
  // Matches the fixed demo code migration 014_institution_access_code.sql
  // backfills for institution_code = 'SKIT'. That backfill only reaches an
  // already-existing SKIT row; on a from-scratch `migrate up` followed by
  // this seed script (migrations always run first), no such row exists yet
  // when 014 runs, so this insert must supply it directly or it fails the
  // column's NOT NULL constraint.
  access_code: 'SKIT-STAFF-2026',
};

const INSTITUTION_STAFF_USER = {
  user_id: INSTITUTION_STAFF_USER_ID,
  clerk_user_id: 'seed_institution_staff',
  full_name: 'Demo Institution Admin',
  email: 'institution.demo@skit.ac.in',
};

const STUDENT_USER = {
  user_id: STUDENT_USER_ID,
  clerk_user_id: 'seed_student_user',
  full_name: 'Demo Student',
  email: 'student.demo@skit.ac.in',
};

const STUDENT_PROFILE = {
  student_id: STUDENT_PROFILE_ID,
  enrollment_number: 'SKIT2027CSE001',
  course: 'B.Tech Computer Science',
  graduation_year: 2027,
};

// ---------------------------------------------------------------------------
// Helpers: each returns { id, created } so the summary can report accurately.
// ---------------------------------------------------------------------------

async function upsertRole(client, roleName, description) {
  const existing = await client.query('SELECT role_id AS id FROM role WHERE role_name = $1', [
    roleName,
  ]);
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, created: false };
  }
  await client.query(
    `INSERT INTO role (role_name, description) VALUES ($1, $2)
     ON CONFLICT (role_name) DO NOTHING`,
    [roleName, description]
  );
  const after = await client.query('SELECT role_id AS id FROM role WHERE role_name = $1', [
    roleName,
  ]);
  return { id: after.rows[0].id, created: true };
}

async function upsertInstitution(client, inst) {
  const existing = await client.query(
    'SELECT institution_id AS id FROM institution WHERE institution_code = $1',
    [inst.institution_code]
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, created: false };
  }
  await client.query(
    `INSERT INTO institution (institution_id, institution_name, institution_code, email, status, access_code)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (institution_code) DO NOTHING`,
    [inst.institution_id, inst.institution_name, inst.institution_code, inst.email, inst.status, inst.access_code]
  );
  const after = await client.query(
    'SELECT institution_id AS id FROM institution WHERE institution_code = $1',
    [inst.institution_code]
  );
  return { id: after.rows[0].id, created: true };
}

async function upsertUserAccount(client, user, roleId, institutionId) {
  const existing = await client.query(
    'SELECT user_id AS id FROM user_account WHERE clerk_user_id = $1',
    [user.clerk_user_id]
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, created: false };
  }
  await client.query(
    `INSERT INTO user_account (user_id, role_id, institution_id, clerk_user_id, full_name, email)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (clerk_user_id) DO NOTHING`,
    [user.user_id, roleId, institutionId, user.clerk_user_id, user.full_name, user.email]
  );
  const after = await client.query(
    'SELECT user_id AS id FROM user_account WHERE clerk_user_id = $1',
    [user.clerk_user_id]
  );
  return { id: after.rows[0].id, created: true };
}

async function upsertStudent(client, userId, institutionId, profile) {
  const existing = await client.query('SELECT student_id AS id FROM student WHERE user_id = $1', [
    userId,
  ]);
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, created: false };
  }
  await client.query(
    `INSERT INTO student (student_id, user_id, institution_id, enrollment_number, course, graduation_year)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO NOTHING`,
    [
      profile.student_id,
      userId,
      institutionId,
      profile.enrollment_number,
      profile.course,
      profile.graduation_year,
    ]
  );
  const after = await client.query('SELECT student_id AS id FROM student WHERE user_id = $1', [
    userId,
  ]);
  return { id: after.rows[0].id, created: true };
}

async function seed() {
  const databaseUrl = getDatabaseUrl();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const summary = [];

  try {
    const institutionRole = await upsertRole(
      client,
      'institution',
      'Institution staff who issue and manage certificates on behalf of their institution'
    );
    summary.push(['role:institution', institutionRole.created]);

    const studentRole = await upsertRole(
      client,
      'student',
      'Student who owns and can share certificates issued to them'
    );
    summary.push(['role:student', studentRole.created]);

    const institution = await upsertInstitution(client, INSTITUTION);
    summary.push([`institution:${INSTITUTION.institution_code}`, institution.created]);

    const institutionStaff = await upsertUserAccount(
      client,
      INSTITUTION_STAFF_USER,
      institutionRole.id,
      institution.id
    );
    summary.push([`user_account:${INSTITUTION_STAFF_USER.clerk_user_id}`, institutionStaff.created]);

    const studentUser = await upsertUserAccount(
      client,
      STUDENT_USER,
      studentRole.id,
      institution.id
    );
    summary.push([`user_account:${STUDENT_USER.clerk_user_id}`, studentUser.created]);

    const student = await upsertStudent(client, studentUser.id, institution.id, STUDENT_PROFILE);
    summary.push([`student:${STUDENT_PROFILE.enrollment_number}`, student.created]);

    console.log('Seed summary:');
    let insertedCount = 0;
    let skippedCount = 0;
    for (const [label, created] of summary) {
      console.log(`  ${created ? 'inserted' : 'already present'}: ${label}`);
      if (created) insertedCount += 1;
      else skippedCount += 1;
    }
    console.log('---');
    console.log(`Seed summary: ${insertedCount} inserted, ${skippedCount} already present.`);
  } catch (err) {
    console.error('Seed run failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
