-- 014_institution_access_code.sql
-- Closes the self-service-signup gap: joining an EXISTING institution by
-- code alone required no proof of actually belonging there. Every
-- institution now also has a shared secret access code that must be
-- supplied (in addition to the public institution_code) to self-register
-- as staff for it. Newly-created institutions get a freshly generated
-- code at creation time; the pre-seeded demo institution (SKIT) gets a
-- fixed, documented demo code here so local dev/testing can proceed
-- immediately without a manual backfill step.

ALTER TABLE institution ADD COLUMN access_code TEXT;

UPDATE institution SET access_code = 'SKIT-STAFF-2026' WHERE institution_code = 'SKIT' AND access_code IS NULL;

-- Any other pre-existing institution without a code yet (should only be
-- SKIT in practice) gets a random one so the NOT NULL constraint below can
-- be applied safely regardless of what's already in a given database.
UPDATE institution SET access_code = upper(substr(md5(random()::text), 1, 12)) WHERE access_code IS NULL;

ALTER TABLE institution ALTER COLUMN access_code SET NOT NULL;
