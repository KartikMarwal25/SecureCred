-- 008_create_revocation.sql
-- One revocation record per certificate (1:1), capturing who revoked it, why,
-- and (optionally) which on-chain transaction performed the revocation.

CREATE TABLE revocation (
  revocation_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id    UUID NOT NULL UNIQUE REFERENCES certificate(certificate_id) ON DELETE RESTRICT,
  revoked_by        UUID NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
  blockchain_tx_id  UUID NULL REFERENCES blockchain_transaction(transaction_id) ON DELETE RESTRICT,
  reason            TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  revoked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
