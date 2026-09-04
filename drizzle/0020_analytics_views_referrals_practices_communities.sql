-- Hand-written migration, tracked in the same journal as generated table
-- migrations (BUILD_SEQUENCE.md Phase 0's migration conventions).
--
-- Second slice of plan §12's analytics views -- Referrals, Practices, and
-- Communities, now that Phases 4/6/8 have built their base tables (0012
-- covered Growth and Verification, the two groups whose tables existed
-- after Phases 1-3). Also fills one Growth gap 0012 left for later:
-- "signups by locality/city, as a simple bar chart" needs home_visit_areas,
-- which didn't exist until Phase 5.
--
-- Same discipline as 0012: every view excludes the PII/free-text columns
-- §8G6 and CLAUDE.md name. For this slice that specifically means never
-- `patient_summary`, `location_address`, `urgency_reason`,
-- `practice_claims.query_message`/`document_url`/`registration_number`,
-- `profile_contact_reveals.ip_hash`/`user_agent`, or any community post's
-- free-text body -- every metric below is an aggregate, a status, a
-- foreign key, or a timestamp. Created as the migration owner, so
-- ahp_analytics gets SELECT automatically via drizzle/0001's
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA analytics` -- no per-view GRANT
-- needed.
--
-- Left out, and why (a gap in the underlying schema, not something a view
-- could paper over): "Posted -> first view, posted -> first interest"
-- needs referral_events' notification_dispatched/referral_viewed rows,
-- which nothing in this codebase writes yet -- Phase 6 only ever inserts
-- 'shortlisted'/'accepted'/'offer_lapsed'. "D30 return" needs a
-- last-active-at concept that was deliberately never built for a
-- therapist-facing engagement signal (plan §9/§10H's rejection of
-- gamified presence metrics) and has no ops-only equivalent either.
-- "Relay referrals with no poster confirmation after 48h" and
-- "poster-reported completion rate" both need a poster-confirmation field
-- that doesn't exist in home_case_referrals. "Therapists with >=2 lapsed
-- acknowledgements" and "contact reveals issued vs. completed handovers"
-- are direct-mode concepts (contact_ack_deadline_at, contact_reveals) --
-- dormant for the entire pilot per CLAUDE.md, so there is nothing to
-- query yet. None of these are silently dropped: flag them here so a
-- future phase adding the missing instrumentation finds this comment
-- rather than rediscovering the gap.

-- --- Growth (addendum) -----------------------------------------------

-- "Signups by locality/city, as a simple bar chart" (§12, NEW in v18) --
-- rolled up to the immediate parent zone, per plan wording. A therapist
-- can cover more than one home-visit area; this deliberately counts each
-- coverage row rather than picking one "primary" area, since none exists
-- in the schema -- acceptable for an admin-only bar chart, never
-- therapist-facing (§10D's rule against public locality leaderboards).
CREATE OR REPLACE VIEW analytics.growth_signups_by_locality AS
SELECT
  zone.id AS zone_id,
  zone.name AS zone_name,
  locality.id AS locality_id,
  locality.name AS locality_name,
  count(DISTINCT u.id) AS therapist_count
FROM users u
JOIN home_visit_areas hva ON hva.user_id = u.id AND hva.deleted_at IS NULL
JOIN areas locality ON locality.id = hva.area_id
LEFT JOIN areas zone ON zone.id = locality.parent_id
WHERE u.account_type = 'therapist' AND u.deleted_at IS NULL
GROUP BY zone.id, zone.name, locality.id, locality.name;

-- --- Referrals ----------------------------------------------------------

-- "Referrals posted / selected / expired-unmatched" (§12).
CREATE OR REPLACE VIEW analytics.referrals_funnel AS
SELECT
  status,
  urgency,
  count(*) AS referral_count
FROM home_case_referrals
WHERE deleted_at IS NULL
GROUP BY status, urgency;

-- "Urgent / routine referral ratio" (§12) -- urgency_reason is
-- deliberately excluded (§8G6's own exclusion list names it explicitly),
-- so this is counts only, never the free text an admin would read on the
-- referral itself.
CREATE OR REPLACE VIEW analytics.referrals_urgency_ratio AS
SELECT
  urgency,
  count(*) AS referral_count
FROM home_case_referrals
WHERE deleted_at IS NULL
GROUP BY urgency;

-- "Median time-to-acceptance" (§12) -- from posting to the accept_referral()
-- transaction's timestamp, referrals that actually reached 'accepted' or
-- beyond only.
CREATE OR REPLACE VIEW analytics.referrals_time_to_acceptance AS
SELECT
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY extract(epoch FROM (accepted_at - created_at)) / 3600
  ) AS median_hours_to_acceptance,
  count(*) AS accepted_count
FROM home_case_referrals
WHERE accepted_at IS NOT NULL AND deleted_at IS NULL;

-- "Referrals with reroute_count >= 2" (§12) -- the full distribution, not
-- just the >=2 count, so an admin can see the shape before the escalation
-- threshold.
CREATE OR REPLACE VIEW analytics.referrals_reroute_distribution AS
SELECT
  reroute_count,
  count(*) AS referral_count
FROM home_case_referrals
WHERE deleted_at IS NULL
GROUP BY reroute_count;

-- "Supply gaps: zone x specialty combinations where matched_pool_size_at_post = 0" (§12).
CREATE OR REPLACE VIEW analytics.referrals_supply_gaps AS
SELECT
  area_id,
  role_needed,
  specialization_needed,
  count(*) AS referral_count
FROM home_case_referrals
WHERE matched_pool_size_at_post = 0 AND deleted_at IS NULL
GROUP BY area_id, role_needed, specialization_needed;

-- "Unserved urgent referrals -- zone, specialty, matched-pool size, time open" (§12).
CREATE OR REPLACE VIEW analytics.referrals_unserved_urgent AS
SELECT
  id AS referral_id,
  area_id,
  role_needed,
  specialization_needed,
  matched_pool_size_at_post,
  extract(epoch FROM (now() - created_at)) / 3600 AS hours_open
FROM home_case_referrals
WHERE urgency = 'urgent' AND status = 'open' AND deleted_at IS NULL;

-- "Public profile contact reveals" (§12) -- count only, never ip_hash/user_agent.
CREATE OR REPLACE VIEW analytics.referrals_public_contact_reveals AS
SELECT
  date_trunc('day', revealed_at)::date AS reveal_date,
  count(*) AS reveal_count
FROM profile_contact_reveals
GROUP BY 1
ORDER BY 1;

-- --- Practices ------------------------------------------------------------

-- "Open practice claims" (§12) -- query_message/document_url/
-- registration_number excluded, same discipline as credentials above.
CREATE OR REPLACE VIEW analytics.practices_claims_queue AS
SELECT
  status,
  count(*) AS claim_count,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY extract(epoch FROM (now() - created_at)) / 3600
  ) AS median_age_hours
FROM practice_claims
WHERE status IN ('submitted', 'under_review', 'query_raised')
GROUP BY status;

-- "Practices flagged possible_duplicate_of or disputed" (§12).
CREATE OR REPLACE VIEW analytics.practices_flagged AS
SELECT
  count(*) FILTER (WHERE claim_status = 'disputed') AS disputed_count,
  count(*) FILTER (WHERE possible_duplicate_of IS NOT NULL) AS possible_duplicate_count
FROM practices
WHERE deleted_at IS NULL;

-- "Claimed practices per city, against the recruiting trigger" (§12) --
-- the pilot is single-city (Hyderabad), and practices carry no structured
-- city column (only Google Places' free-text formatted_address), so this
-- is the citywide total against §2's >=5-approved-claims gate rather than
-- a real per-city breakdown -- correct at pilot scope, revisit if/when
-- multi-city adds a structured city field.
CREATE OR REPLACE VIEW analytics.practices_claimed_progress AS
SELECT count(*) AS claimed_practice_count
FROM practices
WHERE claim_status = 'claimed' AND deleted_at IS NULL;

-- --- Communities ------------------------------------------------------

-- "Certifications pending curation" (§12's "same pattern as course-taxonomy
-- curation", applied to the certification half -- 0012 already covers
-- institutions). Curation status lives on course_completions, not
-- master_courses_certifications -- a completion with no master_course_id
-- match enters this queue with its free-text custom_course_name, per
-- §8B's "master_course_id IS NULL -> pending_review" rule. No PII: a
-- course/certification name a therapist typed, not personal data.
CREATE OR REPLACE VIEW analytics.communities_certifications_pending_curation AS
SELECT
  id AS course_completion_id,
  custom_course_name,
  provider_name,
  extract(epoch FROM (now() - created_at)) / 3600 AS age_hours
FROM course_completions
WHERE curation_status = 'pending_review' AND deleted_at IS NULL;

-- "Posts pending review" (§12) -- the founding-cohort community (Phase 8)
-- always publishes immediately, so this is 0 until Phase 9's institution/
-- certification communities ship; the view exists now so that phase adds
-- no new reporting surface, only rows.
CREATE OR REPLACE VIEW analytics.communities_posts_pending_review AS
SELECT
  community_id,
  count(*) AS pending_post_count,
  min(created_at) AS oldest_pending_at
FROM community_posts
WHERE status = 'pending_review' AND deleted_at IS NULL
GROUP BY community_id;
