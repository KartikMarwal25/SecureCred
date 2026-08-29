-- 002_create_institution.sql
-- Institutions registered on the platform (universities, colleges, training bodies).

CREATE TABLE institution (
  institution_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_name  TEXT NOT NULL,
  institution_code  TEXT NOT NULL UNIQUE CHECK (institution_code ~ '^[A-Z0-9]{3,8}$'),
  email             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  issuer_address    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
