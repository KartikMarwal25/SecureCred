-- 007_create_blockchain_transaction.sql
-- Every on-chain transaction (issue/revoke) submitted for a certificate,
-- tracked through its confirmation lifecycle.

CREATE TABLE blockchain_transaction (
  transaction_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id      UUID NOT NULL REFERENCES certificate(certificate_id) ON DELETE RESTRICT,
  transaction_hash    TEXT NOT NULL UNIQUE,
  transaction_type    TEXT NOT NULL CHECK (transaction_type IN ('ISSUE','REVOKE')),
  network             TEXT NOT NULL,
  contract_address    TEXT NOT NULL,
  transaction_status  TEXT NOT NULL DEFAULT 'PENDING' CHECK (transaction_status IN ('PENDING','CONFIRMED','FAILED')),
  block_number        BIGINT,
  confirmations       INTEGER NOT NULL DEFAULT 0,
  gas_used            NUMERIC(30,0),
  revert_reason       TEXT,
  nonce               INTEGER,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT now()
);
