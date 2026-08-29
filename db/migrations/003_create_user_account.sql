-- 003_create_user_account.sql
-- Application user accounts. Identity/authentication is fully owned by Clerk;
-- this table only stores the profile + authorization linkage.

CREATE TABLE user_account (
  user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id         UUID NOT NULL REFERENCES role(role_id) ON DELETE RESTRICT,
  institution_id  UUID NULL REFERENCES institution(institution_id) ON DELETE RESTRICT,
  clerk_user_id   TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  account_status  TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- No password column: Clerk owns all credentials.
