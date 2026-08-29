-- 010_create_audit_log.sql
-- General-purpose append-only audit trail for privileged/administrative actions.

CREATE TABLE audit_log (
  audit_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
