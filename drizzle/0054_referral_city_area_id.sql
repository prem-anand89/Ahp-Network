ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_first_look_single_target";--> statement-breakpoint
ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_first_look_window";--> statement-breakpoint
ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_first_look_expand";--> statement-breakpoint
ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_first_look_routine_only";--> statement-breakpoint
ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_first_look_opens_at";--> statement-breakpoint
ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_area_scope_check";--> statement-breakpoint
ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_area_scope_home_visit";--> statement-breakpoint
ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_area_scope_area_id";--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "city_area_id" uuid;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_city_area_id_areas_id_fk" FOREIGN KEY ("city_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "home_case_referrals_open_by_city" ON "home_case_referrals" USING btree ("city_area_id","status") WHERE "home_case_referrals"."deleted_at" IS NULL;--> statement-breakpoint

-- Backfill: nullable, not required (see schema.ts's comment — plenty of
-- test scaffolding inserts rows with no area at all, same reasoning
-- 0048 gives for area_id), but every real row should carry one going
-- forward from here. A locality-scope row's city is its area's own
-- city_area_id (set for every area by 0051). A city-scope row has no
-- area_id to derive from — it backfills to Hyderabad's own city row
-- when that seed exists, same guarded pattern 0051 uses; a dev/test DB
-- that never ran the 0007 seed simply has nothing to backfill those to,
-- and city_area_id stays NULL there, which is fine since it's nullable.
UPDATE "home_case_referrals" r
SET "city_area_id" = a."city_area_id"
FROM "areas" a
WHERE r."area_id" = a."id" AND r."city_area_id" IS NULL;
--> statement-breakpoint
DO $$
DECLARE
  v_hyderabad_id uuid;
BEGIN
  SELECT id INTO v_hyderabad_id FROM areas WHERE area_level = 'city' AND slug = 'hyderabad';
  IF v_hyderabad_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE home_case_referrals
  SET city_area_id = v_hyderabad_id
  WHERE area_scope = 'city' AND city_area_id IS NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_single_target" CHECK (num_nonnulls("home_case_referrals"."initial_circle_id", "home_case_referrals"."first_look_community_id", "home_case_referrals"."first_look_therapist_id") <= 1);--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_window" CHECK ((num_nonnulls("home_case_referrals"."initial_circle_id", "home_case_referrals"."first_look_community_id", "home_case_referrals"."first_look_therapist_id") = 1) = ("home_case_referrals"."circle_first_window" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_expand" CHECK ("home_case_referrals"."expand_to_network" OR num_nonnulls("home_case_referrals"."initial_circle_id", "home_case_referrals"."first_look_community_id", "home_case_referrals"."first_look_therapist_id") = 1);--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_routine_only" CHECK ("home_case_referrals"."urgency" = 'routine' OR num_nonnulls("home_case_referrals"."initial_circle_id", "home_case_referrals"."first_look_community_id", "home_case_referrals"."first_look_therapist_id") = 0);--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_opens_at" CHECK (("home_case_referrals"."circle_first_window" IS NOT NULL) = ("home_case_referrals"."circle_first_opens_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_area_scope_check" CHECK ("home_case_referrals"."area_scope" IN ('locality', 'city'));--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_area_scope_home_visit" CHECK ("home_case_referrals"."area_scope" = 'locality' OR "home_case_referrals"."home_visit_required" = false);--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_area_scope_area_id" CHECK ("home_case_referrals"."area_scope" = 'locality' OR "home_case_referrals"."area_id" IS NULL);