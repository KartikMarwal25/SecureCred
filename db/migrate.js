#!/usr/bin/env node
// db/migrate.js
//
// Minimal, dependency-light migration runner. No ORM, no migration framework:
// plain `pg` + plain numbered .sql files under db/migrations/, applied in
// ascending filename order and tracked in a `schema_migrations` table.
//
// Usage:
//   node migrate.js up

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the repo root if present. Does not override variables that
// are already set in the environment (e.g. a test harness overriding
// DATABASE_URL for a throwaway container).
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

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

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

// A small number of PostgreSQL utility statements (e.g. CREATE DATABASE,
// CREATE TABLESPACE, VACUUM, and in some server configurations role/grant
// management) are not allowed to run inside an explicit transaction block.
// If a migration fails for that specific reason, we retry it once in
// "autocommit" mode (no explicit BEGIN/COMMIT wrapper from this script) so
// PostgreSQL can run each statement under its own implicit transaction
// instead of the one we tried to impose.
const NON_TRANSACTIONAL_ERROR_HINTS = [
  'cannot run inside a transaction block',
  'cannot be executed from a function',
  'cannot be executed within a pipeline',
];

function looksNonTransactional(err) {
  const msg = (err && err.message ? err.message : '').toLowerCase();
  return NON_TRANSACTIONAL_ERROR_HINTS.some((hint) => msg.includes(hint));
}

async function markApplied(client, filename) {
  await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
}

// Preferred path: run the whole migration file plus the bookkeeping insert
// as a single atomic transaction.
async function runMigrationInTransaction(client, sql, filename) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await markApplied(client, filename);
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors (e.g. connection already broken)
    }
    throw err;
  }
}

// Split a SQL file into individual top-level statements, respecting
// dollar-quoted bodies (e.g. `DO $$ ... $$;`), single-quoted string
// literals, double-quoted identifiers, and line/block comments, so a
// semicolon inside any of those is NOT treated as a statement boundary.
//
// This matters for the autocommit fallback below: PostgreSQL treats a
// *multi-statement* string sent over the simple query protocol as one
// implicit transaction block, even with no explicit BEGIN/COMMIT from us.
// A statement that genuinely cannot run inside a transaction block would
// still fail if we merely resent the whole file as one string. Splitting
// into individual statements and sending each as its own query message is
// what actually achieves per-statement autocommit.
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end + 1;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          j += 2;
          continue;
        }
        if (sql[j] === '"') {
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    if (ch === '$') {
      const tagMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        const stop = closeIdx === -1 ? n : closeIdx + tag.length;
        current += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (ch === ';') {
      current += ch;
      const trimmed = current.trim();
      if (hasSqlContent(trimmed)) {
        statements.push(trimmed);
      }
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const trailing = current.trim();
  if (hasSqlContent(trailing)) {
    statements.push(trailing);
  }

  return statements;
}

// Best-effort check for whether a fragment has any real SQL content once
// comments are stripped, so a trailing comment-only remainder (no statement
// ever showed up after it) isn't sent to the server as a no-op query.
function hasSqlContent(fragment) {
  const withoutLineComments = fragment.replace(/--[^\n]*/g, '');
  const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlockComments.trim().length > 0;
}

// Fallback path for the rare statement that refuses to run inside a
// transaction block. Each statement is sent as its own separate query
// message (no explicit BEGIN/COMMIT), so PostgreSQL genuinely autocommits
// each one individually instead of grouping them into one implicit
// transaction. We mark the migration applied as a final separate statement.
async function runMigrationAutocommit(client, sql, filename) {
  const statements = splitStatements(sql);
  for (const statement of statements) {
    await client.query(statement);
  }
  await markApplied(client, filename);
}

async function up() {
  const databaseUrl = getDatabaseUrl();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let applied = 0;
  let skipped = 0;

  try {
    await ensureMigrationsTable(client);
    const alreadyApplied = await getAppliedMigrations(client);
    const files = listMigrationFiles();

    if (files.length === 0) {
      console.log(`No migration files found in ${MIGRATIONS_DIR}`);
    }

    for (const file of files) {
      if (alreadyApplied.has(file)) {
        skipped += 1;
        continue;
      }

      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(fullPath, 'utf8');

      try {
        await runMigrationInTransaction(client, sql, file);
      } catch (err) {
        if (looksNonTransactional(err)) {
          console.warn(
            `  [${file}] contains a statement that cannot run inside a transaction block ` +
              `(${err.message}); retrying autocommit...`
          );
          await runMigrationAutocommit(client, sql, file);
        } else {
          console.error(`FAILED applying migration: ${file}`);
          console.error(`  ${err.message}`);
          throw err;
        }
      }

      console.log(`applied: ${file}`);
      applied += 1;
    }

    console.log('---');
    console.log(`Migration summary: ${applied} applied, ${skipped} already up to date.`);
  } catch (err) {
    console.error('Migration run stopped due to a failed migration. No further files were applied.');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

async function main() {
  const command = process.argv[2];

  if (command === 'up') {
    await up();
    return;
  }

  console.error('Usage: node migrate.js up');
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
