-- 005_create_certificate.sql
-- Core certificate record: the source of truth for a certificate's lifecycle,
-- from off-chain creation through blockchain anchoring to revocation.

CREATE TABLE certificate (
  certificate_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id           UUID NOT NULL REFERENCES student(student_id) ON DELETE RESTRICT,
  institution_id       UUID NOT NULL REFERENCES institution(institution_id) ON DELETE RESTRICT,
  issued_by            UUID NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
  certificate_number   TEXT NOT NULL UNIQUE,
  title                TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  certificate_type     TEXT NOT NULL CHECK (certificate_type IN ('DEGREE','DIPLOMA','COURSE_COMPLETION')),
  issue_date           DATE NOT NULL CHECK (issue_date <= CURRENT_DATE),
  attributes           JSONB,
  certificate_hash     CHAR(64) NOT NULL UNIQUE CHECK (certificate_hash ~ '^[0-9a-f]{64}$'),
  template_version     TEXT NOT NULL,
  blockchain_cert_id   TEXT,
  status               TEXT NOT NULL DEFAULT 'PENDING_STORAGE'
                       CHECK (status IN ('PENDING_STORAGE','PENDING_ANCHOR','ANCHORING',
                                          'ACTIVE','REVOKING','REVOKED','FAILED')),
  failure_cause        TEXT,
  reconcile_attempts   INTEGER NOT NULL DEFAULT 0,
  last_chain_check_at  TIMESTAMPTZ,
  last_confirmed_chain_state JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
