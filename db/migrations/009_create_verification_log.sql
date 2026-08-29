-- 009_create_verification_log.sql
-- Record of each public verification attempt against a certificate.
-- Deliberately no IP/user-agent/session captured (privacy).

CREATE TABLE verification_log (
  verification_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id       UUID NOT NULL REFERENCES certificate(certificate_id) ON DELETE RESTRICT,
  verifier_user_id     UUID NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
  verification_method  TEXT NOT NULL CHECK (verification_method IN ('QR_CODE','CERT_ID','HASH')),
  verification_result  TEXT NOT NULL CHECK (verification_result IN ('VERIFIED','REVOKED','TAMPERED','NOT_FOUND')),
  degraded             BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
