-- 006_create_certificate_file.sql
-- Files (typically the rendered PDF) associated with a certificate, pinned to IPFS.

CREATE TABLE certificate_file (
  file_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id  UUID NOT NULL REFERENCES certificate(certificate_id) ON DELETE RESTRICT,
  file_name       TEXT NOT NULL,
  file_type       TEXT NOT NULL DEFAULT 'application/pdf',
  ipfs_cid        TEXT NOT NULL,
  byte_size       INTEGER NOT NULL CHECK (byte_size > 0),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
