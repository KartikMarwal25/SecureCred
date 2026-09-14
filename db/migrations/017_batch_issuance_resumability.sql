-- 017_batch_issuance_resumability.sql
-- Batch issuance previously had no way to recover from a server restart or
-- crash mid-batch: `batch_issuance_job.status` could sit at 'PROCESSING'
-- forever with rows still 'PENDING' and nothing left to ever resume them
-- (the original processing loop existed only as an in-memory promise inside
-- one API request, never a durable, resumable task). These columns let the
-- worker detect a stalled job (no progress for a while) and pick it back up
-- from its still-PENDING rows only — completed rows are never reprocessed.

-- Bumped by every progress/status write so a stalled-job sweep (mirroring
-- certificate.updated_at / findStalled in reconciler.js) can tell "actively
-- being worked" apart from "abandoned mid-batch."
ALTER TABLE batch_issuance_job ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Set right before a row's issuanceService.issue() call begins, left
-- untouched on success/failure. A row found PENDING with started_at already
-- set means a previous attempt began but the process died before recording
-- an outcome — resuming it must check whether a certificate already exists
-- for it (see batchIssuanceService.js) before retrying, so a crash at that
-- exact moment can never double-issue.
ALTER TABLE batch_issuance_row ADD COLUMN started_at TIMESTAMPTZ;

CREATE INDEX batch_issuance_job_stalled_idx ON batch_issuance_job (status, updated_at)
  WHERE status IN ('PENDING', 'PROCESSING');
