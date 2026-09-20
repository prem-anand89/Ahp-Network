-- Hand-added (drizzle-kit's generated ALTER can't know about this):
-- two analytics views read home_case_referrals.specialization_needed,
-- and Postgres refuses to ALTER COLUMN TYPE while a view depends on the
-- column. Dropped here, recreated verbatim at the end of this file —
-- same SELECT as drizzle/0020_analytics_views_referrals_practices_communities.sql,
-- just against the now-text column instead of the enum.
DROP VIEW analytics.referrals_supply_gaps;--> statement-breakpoint
DROP VIEW analytics.referrals_unserved_urgent;--> statement-breakpoint
ALTER TABLE "communities" ALTER COLUMN "specialization" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ALTER COLUMN "specialization_needed" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "specializations" SET DATA TYPE text[];--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "specializations" SET DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_specialization_check" CHECK ("communities"."specialization" IS NULL OR "communities"."specialization" IN ('musculoskeletal_orthopaedic','neuro_rehab','sports_rehab','cardiopulmonary_rehab','womens_pelvic_health','post_surgical_rehab','vestibular_balance','hand_therapy','pain_management','oncology_rehab','speech_language_developmental','dysphagia_swallowing','mental_health_ot'));--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_specialization_needed_check" CHECK ("home_case_referrals"."specialization_needed" IN ('musculoskeletal_orthopaedic','neuro_rehab','sports_rehab','cardiopulmonary_rehab','womens_pelvic_health','post_surgical_rehab','vestibular_balance','hand_therapy','pain_management','oncology_rehab','speech_language_developmental','dysphagia_swallowing','mental_health_ot'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_specializations_check" CHECK ("users"."specializations" <@ ARRAY['musculoskeletal_orthopaedic','neuro_rehab','sports_rehab','cardiopulmonary_rehab','womens_pelvic_health','post_surgical_rehab','vestibular_balance','hand_therapy','pain_management','oncology_rehab','speech_language_developmental','dysphagia_swallowing','mental_health_ot']::text[]);--> statement-breakpoint
DROP TYPE "public"."specialization_type";--> statement-breakpoint
CREATE VIEW analytics.referrals_supply_gaps AS
SELECT
  area_id,
  role_needed,
  specialization_needed,
  count(*) AS referral_count
FROM home_case_referrals
WHERE matched_pool_size_at_post = 0 AND deleted_at IS NULL
GROUP BY area_id, role_needed, specialization_needed;--> statement-breakpoint
CREATE VIEW analytics.referrals_unserved_urgent AS
SELECT
  id AS referral_id,
  area_id,
  role_needed,
  specialization_needed,
  matched_pool_size_at_post,
  extract(epoch FROM (now() - created_at)) / 3600 AS hours_open
FROM home_case_referrals
WHERE urgency = 'urgent' AND status = 'open' AND deleted_at IS NULL;