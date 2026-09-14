-- 016_create_batch_issuance.sql
-- Tracks CSV batch-issuance jobs so a large upload (an institution issuing
-- a whole graduating cohort at once) can be processed asynchronously and
-- polled for progress, instead of holding one HTTP request open for
-- however long hundreds of on-chain anchors take to broadcast.

CREATE TABLE batch_issuance_job (
  batch_job_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES institution(institution_id) ON DELETE RESTRICT,
  created_by       UUID NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  total_rows       INTEGER NOT NULL CHECK (total_rows > 0),
  processed_rows   INTEGER NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  succeeded_rows   INTEGER NOT NULL DEFAULT 0 CHECK (succeeded_rows >= 0),
  failed_rows      INTEGER NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX batch_issuance_job_institution_idx ON batch_issuance_job (institution_id, created_at DESC);

-- One row per CSV line. `input_data` keeps exactly what was parsed from that
-- row (pre-validation) so a failed row's original input is always
-- inspectable, not just its error message.
CREATE TABLE batch_issuance_row (
  batch_row_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_job_id     UUID NOT NULL REFERENCES batch_issuance_job(batch_job_id) ON DELETE CASCADE,
  row_number       INTEGER NOT NULL CHECK (row_number > 0),
  input_data       JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  certificate_id   UUID REFERENCES certificate(certificate_id) ON DELETE SET NULL,
  error_message    TEXT,
  processed_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX batch_issuance_row_job_row_unique ON batch_issuance_row (batch_job_id, row_number);
CREATE INDEX batch_issuance_row_job_status_idx ON batch_issuance_row (batch_job_id, status);

-- 013_app_role_and_privileges.sql revoked-then-granted against the tables
-- that existed at the time; tables created afterward need their own
-- explicit GRANT (same note as 015). No DELETE on either table — a batch
-- job's history is never removed, only its rows cascade if the job itself
-- is (which the application never does).
GRANT SELECT, INSERT, UPDATE ON batch_issuance_job TO securecred_app;
GRANT SELECT, INSERT, UPDATE ON batch_issuance_row TO securecred_app;
