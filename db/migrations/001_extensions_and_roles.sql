-- 001_extensions_and_roles.sql
-- Enable pgcrypto (for gen_random_uuid()) and create the `role` lookup table,
-- seeding the two permitted role rows used throughout the schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE role (
  role_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name    TEXT NOT NULL UNIQUE CHECK (role_name IN ('institution','student')),
  description  TEXT NOT NULL
);

INSERT INTO role (role_name, description) VALUES
  ('institution', 'Institution staff who issue and manage certificates on behalf of their institution'),
  ('student',     'Student who owns and can share certificates issued to them')
ON CONFLICT (role_name) DO NOTHING;
