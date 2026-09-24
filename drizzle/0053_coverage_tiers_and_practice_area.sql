-- Round 3 step C — validated against an interactive mockup before
-- building (city/state switcher, live search, a working zone checklist;
-- see the plan doc). Two additions:
--
-- 1. home_visit_areas.tier ('primary' | 'secondary'): Primary areas show
--    on the public profile/directory card, Secondary is a wider net the
--    therapist is still notified against but is never shown publicly.
--    Matching itself never filters on tier — display only. Existing rows
--    default to 'primary', which is the correct backfill: every
--    home-visit area on file today was picked as an active service area
--    under the old single-tier model.
--
-- 2. practices.area_id: the practice's locality in the national
--    registry, distinct from the existing Places address fields.
ALTER TABLE "home_visit_areas" ADD COLUMN "tier" text DEFAULT 'primary' NOT NULL;
--> statement-breakpoint
ALTER TABLE "home_visit_areas" ADD CONSTRAINT "home_visit_areas_tier_check" CHECK ("tier" IN ('primary', 'secondary'));
--> statement-breakpoint

ALTER TABLE "practices" ADD COLUMN "area_id" uuid;
--> statement-breakpoint
ALTER TABLE "practices" ADD CONSTRAINT "practices_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id");
