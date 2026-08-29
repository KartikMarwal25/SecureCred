-- 012_create_indexes.sql
-- Query-pattern-driven indexes for certificate listing, worker polling,
-- verification history, and audit lookups.

CREATE INDEX idx_certificate_institution_created ON certificate (institution_id, created_at DESC, certificate_id DESC);
CREATE INDEX idx_certificate_institution_status  ON certificate (institution_id, status);
CREATE INDEX idx_certificate_student_status       ON certificate (student_id, status) WHERE status IN ('ACTIVE','REVOKED');
CREATE INDEX idx_certificate_stalled              ON certificate (status, updated_at) WHERE status IN ('PENDING_STORAGE','PENDING_ANCHOR','ANCHORING','REVOKING');
CREATE INDEX idx_tx_certificate_type_time         ON blockchain_transaction (certificate_id, transaction_type, timestamp DESC);
CREATE INDEX idx_tx_pending                       ON blockchain_transaction (transaction_status, timestamp) WHERE transaction_status='PENDING';
CREATE INDEX idx_file_certificate                 ON certificate_file (certificate_id);
CREATE INDEX idx_verification_cert_time           ON verification_log (certificate_id, verified_at DESC);
CREATE INDEX idx_audit_entity                     ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_user                       ON audit_log (user_id, created_at DESC);
CREATE INDEX idx_user_institution                 ON user_account (institution_id);
CREATE INDEX idx_student_user                     ON student (user_id);
