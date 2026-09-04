-- Hand-written migration, tracked in the same journal as generated table
-- migrations (BUILD_SEQUENCE.md Phase 0's migration conventions).
--
-- First slice of plan §12's analytics views -- Growth and Verification
-- only, since those are the two metric groups whose base tables actually
-- exist after Phases 1-3 (Referrals/Practices/Communities wait on their
-- own phases' tables). Built incrementally rather than all at once at the
-- end, so each phase's views land while that phase's schema is still
-- fresh in context, and Phase 10 (whenever Metabase arrives) has less
-- left to build.
--
-- Every view excludes the PII/free-text columns plan §12 and CLAUDE.md
-- name: no legal_name, email, ocr_extracted_json, registration_number,
-- document_url, query_message, or audit_logs before/after_state. Created
-- as the migration owner, so ahp_analytics gets SELECT automatically via
-- drizzle/0001's `ALTER DEFAULT PRIVILEGES IN SCHEMA analytics` -- no
-- per-view GRANT needed.

-- --- Growth ---------------------------------------------------------------

CREATE OR REPLACE VIEW analytics.growth_daily_signups AS
SELECT
  date_trunc('day', created_at)::date AS signup_date,
  count(*) AS signups
FROM users
WHERE account_type = 'therapist' AND deleted_at IS NULL
GROUP BY 1
ORDER BY 1;

-- "Signup -> checked conversion" (§12): a signup counts as "checked" once
-- verification_stage has moved off 'unverified' at all -- either tier.
CREATE OR REPLACE VIEW analytics.growth_verification_funnel AS
SELECT
  verification_stage,
  count(*) AS therapist_count
FROM users
WHERE account_type = 'therapist' AND deleted_at IS NULL
GROUP BY 1;

-- --- Verification -----------------------------------------------------

-- "Verification queue depth and median age of oldest item" (§12) --
-- query_raised is deliberately excluded, same as the admin queue UI
-- (plan §8A: it leaves the main queue so it doesn't inflate this number).
CREATE OR REPLACE VIEW analytics.verification_queue_depth AS
SELECT
  count(*) AS queue_depth,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY extract(epoch FROM (now() - created_at)) / 3600
  ) AS median_age_hours,
  max(extract(epoch FROM (now() - created_at)) / 3600) AS oldest_age_hours
FROM credentials
WHERE status IN ('pending', 'under_review') AND deleted_at IS NULL;

-- "Credentials in query_raised and their age" (§12) -- id and type only,
-- never query_message (free text an admin wrote, not guaranteed PII-free).
CREATE OR REPLACE VIEW analytics.verification_query_raised_age AS
SELECT
  id AS credential_id,
  type AS credential_type,
  extract(epoch FROM (now() - query_raised_at)) / 3600 AS age_hours
FROM credentials
WHERE status = 'query_raised';

-- "Institutions pending curation" (§12) -- master_institutions carries no
-- PII (plan §8H's retention matrix: "No PII -- institution names only"),
-- so the name itself is fine to surface here.
CREATE OR REPLACE VIEW analytics.verification_institutions_pending_curation AS
SELECT
  id AS institution_id,
  name,
  city,
  extract(epoch FROM (now() - created_at)) / 3600 AS age_hours
FROM master_institutions
WHERE curation_status = 'pending_review';

-- "Admin-role holders who also hold verified therapist profiles" (§12) --
-- count only, no names; a §8G5 "one account, two contexts" cross-check.
CREATE OR REPLACE VIEW analytics.verification_admin_dual_role AS
SELECT
  count(DISTINCT au.user_id) AS dual_role_admin_count
FROM admin_users au
JOIN admin_user_roles r ON r.admin_user_id = au.id AND r.revoked_at IS NULL
JOIN users u ON u.id = au.user_id
WHERE u.verification_stage IN ('qualification_confirmed', 'credentials_verified')
  AND u.deleted_at IS NULL;
