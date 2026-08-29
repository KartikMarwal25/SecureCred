-- 011_create_worker_cursor.sql
-- Durable cursor storage for background workers (e.g. chain-event followers).

CREATE TABLE worker_cursor (
  cursor_key    TEXT PRIMARY KEY,
  cursor_value  BIGINT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
