-- 013_app_role_and_privileges.sql
-- Dedicated least-privilege application role. securecred_app is the only role
-- the running application ever connects as; it gets no DELETE anywhere, and
-- only INSERT/SELECT (no UPDATE) on the two append-only log tables
-- (audit_log, verification_log). This is a real security control enforced by
-- the database's own grant system, not just application-level convention.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'securecred_app') THEN
    CREATE ROLE securecred_app LOGIN PASSWORD 'securecred_dev_password';
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM securecred_app;

GRANT SELECT, INSERT, UPDATE ON institution, user_account, student, certificate,
  certificate_file, blockchain_transaction, revocation, worker_cursor TO securecred_app;

GRANT SELECT ON role TO securecred_app;

GRANT SELECT, INSERT ON audit_log, verification_log TO securecred_app;

GRANT USAGE ON SCHEMA public TO securecred_app;
