# SecureCred database

Plain SQL migrations run with a small custom Node script — no ORM, no
migration framework. Everything here lives under `db/` only.

## Configuration

Set `DATABASE_URL` (either in your environment, or in a `.env` file at the
**repo root** — both `migrate.js` and `seeds/seed.js` load it from there via
`dotenv`). Expected shape:

```
DATABASE_URL=postgres://securecred_app:securecred_dev_password@localhost:5432/securecred
```

The `securecred_app` user/password above is created by migration
`013_app_role_and_privileges.sql` for local development. Use whatever
superuser/owner role your Postgres instance needs for running migrations
themselves (migrations create tables, extensions, and the `securecred_app`
role, which requires more privilege than `securecred_app` has).

## Running

From inside `db/`:

```
npm run migrate   # applies any not-yet-applied files in migrations/, in order
npm run seed      # inserts local dev/demo data (idempotent, safe to rerun)
```

Or from the repo root:

```
node db/migrate.js up
node db/seeds/seed.js
```

Migrations are tracked in a `schema_migrations` table (created automatically
on first run) keyed by filename, so `npm run migrate` is always safe to
re-run — anything already applied is skipped.

## Security note

The application's runtime database role, `securecred_app`, only ever has
**INSERT/SELECT** (no UPDATE, no DELETE) on `audit_log` and `verification_log`
— the two append-only log tables — enforced at the Postgres grant level, not
just by application code. It has SELECT/INSERT/UPDATE (no DELETE) on the
regular operational tables, and read-only SELECT on `role`. Nothing in the
schema ever grants `securecred_app` DELETE on anything.
