-- Review item #1 — a referral for a clinic visit, where the patient is
-- willing to travel, shouldn't force a locality choice it doesn't need.
-- Scoped deliberately narrow: city-wide is refused for a home visit — a
-- therapist travelling TO the patient is inherently locality-bound, only
-- the reverse (patient travelling to a clinic) can be area-agnostic.
--
-- area_id (already nullable) stays NULL for a city-wide post; area_scope
-- is what makes "no area" a deliberate choice rather than a forgotten
-- field, structurally enforced rather than left to the posting form's
-- own discipline.
ALTER TABLE "home_case_referrals" ADD COLUMN "area_scope" text DEFAULT 'locality' NOT NULL;--> statement-breakpoint

ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_area_scope_check" CHECK (area_scope IN ('locality', 'city'));--> statement-breakpoint

ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_area_scope_home_visit" CHECK (area_scope = 'locality' OR home_visit_required = false);--> statement-breakpoint

-- One-directional deliberately: 'city' must never carry a stale/wrong
-- area_id, but 'locality' with a NULL area_id is left alone — plenty of
-- pre-existing test scaffolding across the codebase constructs
-- home_case_referrals rows with no area_id at all for reasons unrelated
-- to area matching (concurrency, erasure, data-export, load tests), and
-- a two-directional CHECK here would have broken all of it for no
-- correctness gain; postReferralTx's own application-level validation
-- already requires a real area_id for a real 'locality' post.
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_area_scope_area_id" CHECK (area_scope = 'locality' OR area_id IS NULL);
