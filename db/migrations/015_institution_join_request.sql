-- 015_institution_join_request.sql
-- Closes the gap owner-gating rotation didn't: possessing the institution
-- access code used to grant INSTANT staff privileges — including the power
-- to issue certificates and to revoke them, which BR-03 makes permanent and
-- irreversible, with no reinstatement path anywhere in the system. Now,
-- supplying the access code only starts a join request; an existing staff
-- member of that institution must explicitly approve it before the
-- requester gets any real access at all.

CREATE TABLE institution_join_request (
  request_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES institution(institution_id) ON DELETE RESTRICT,
  clerk_user_id   TEXT NOT NULL,
  email           TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ,
  decided_by      UUID REFERENCES user_account(user_id) ON DELETE RESTRICT
);

-- One live (pending) request per person per institution — a rejected
-- request doesn't block requesting again, only an already-pending one does.
CREATE UNIQUE INDEX institution_join_request_pending_unique
  ON institution_join_request (institution_id, clerk_user_id)
  WHERE status = 'PENDING';

CREATE INDEX institution_join_request_institution_status_idx
  ON institution_join_request (institution_id, status);

-- 013_app_role_and_privileges.sql revoked-then-granted against the tables
-- that existed at the time; a table created afterward starts with no grants
-- for securecred_app at all and needs its own explicit GRANT here. No
-- DELETE — requests are never removed, only transitioned to APPROVED/REJECTED.
GRANT SELECT, INSERT, UPDATE ON institution_join_request TO securecred_app;

