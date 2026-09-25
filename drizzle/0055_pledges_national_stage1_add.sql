-- Round 3 step E — stage 1 of 2 (add new columns alongside the old ones;
-- 0056 drops the old ones). Split into two migrations because drizzle-kit
-- can't disambiguate "rename text->uuid column" from "drop one, add a
-- different one" without an interactive prompt, which a non-interactive
-- migration run can't answer — see this file's own generation notes.
--
-- pledges.target_city (free text, PLEDGE_CITY_OPTIONS-validated) becomes
-- target_city_area_id (a real areas FK — cities now come from the
-- national registry, not a short hand-picked list). unlocked_cities.city
-- (text PK) becomes city_area_id (uuid PK). Both old columns are backfilled
-- by name match against approved city-level areas rows; a row that can't
-- map (a pledge for a city not yet in the registry, or an unlock row for
-- one) is dropped, per the plan's own "map by name where possible,
-- otherwise drop them" — never left half-migrated with a NULL that would
-- violate the NOT NULL/PK these columns get in 0056.

ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_first_look_window";--> statement-breakpoint
ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_first_look_routine_only";--> statement-breakpoint

ALTER TABLE "pledges" ADD COLUMN "target_city_area_id" uuid;--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_target_city_area_id_areas_id_fk" FOREIGN KEY ("target_city_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "unlocked_cities" ADD COLUMN "city_area_id" uuid;--> statement-breakpoint
ALTER TABLE "unlocked_cities" ADD CONSTRAINT "unlocked_cities_city_area_id_areas_id_fk" FOREIGN KEY ("city_area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Backfill by name — case-insensitive, city-level, approved rows only.
UPDATE "pledges" p
SET "target_city_area_id" = a.id
FROM "areas" a
WHERE p."target_type" = 'city'
  AND p."target_city_area_id" IS NULL
  AND lower(a.name) = lower(p."target_city")
  AND a.area_level = 'city'
  AND a.curation_status = 'approved'
  AND a.is_active = true;
--> statement-breakpoint

UPDATE "unlocked_cities" u
SET "city_area_id" = a.id
FROM "areas" a
WHERE u."city_area_id" IS NULL
  AND lower(a.name) = lower(u."city")
  AND a.area_level = 'city'
  AND a.curation_status = 'approved'
  AND a.is_active = true;
--> statement-breakpoint

-- A pledge or unlock row that didn't map to a real city (the plan's
-- "otherwise drop them") — a stale entry for a city name that either
-- never had a matching registry row or was a typo/variant spelling.
DELETE FROM "pledges" WHERE "target_type" = 'city' AND "target_city_area_id" IS NULL;
--> statement-breakpoint
DELETE FROM "unlocked_cities" WHERE "city_area_id" IS NULL;
--> statement-breakpoint

-- Hyderabad is always unlocked (it's the pilot's own city) — seeded here
-- rather than assumed already present, guarded the same way 0051 guards
-- its own Hyderabad reconcile: a dev/test DB that never ran the 0007 seed
-- has nothing to seed this against.
DO $$
DECLARE
  v_hyderabad_id uuid;
  v_system_admin_id uuid;
BEGIN
  SELECT id INTO v_hyderabad_id FROM areas WHERE area_level = 'city' AND slug = 'hyderabad';
  IF v_hyderabad_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM unlocked_cities WHERE city_area_id = v_hyderabad_id) THEN
    RETURN;
  END IF;

  -- unlocked_by_admin_id is NOT NULL — this seed predates any specific
  -- admin action, so it's attributed to whichever admin row is oldest
  -- (the founder's own account, in practice). A DB with no admin_users
  -- row yet (fresh dev/test DB) has nothing to attribute this to either;
  -- skip rather than fail the migration.
  SELECT id INTO v_system_admin_id FROM admin_users ORDER BY created_at ASC LIMIT 1;
  IF v_system_admin_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO unlocked_cities (city_area_id, unlocked_by_admin_id)
  VALUES (v_hyderabad_id, v_system_admin_id);
END $$;
--> statement-breakpoint

ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_window" CHECK ((num_nonnulls("home_case_referrals"."initial_circle_id", "home_case_referrals"."first_look_community_id", "home_case_referrals"."first_look_therapist_id") = 1 AND "home_case_referrals"."urgency" = 'routine') = ("home_case_referrals"."circle_first_window" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_routine_only" CHECK ("home_case_referrals"."urgency" = 'routine' OR num_nonnulls("home_case_referrals"."initial_circle_id", "home_case_referrals"."first_look_community_id", "home_case_referrals"."first_look_therapist_id") = 0 OR ("home_case_referrals"."first_look_therapist_id" IS NOT NULL AND "home_case_referrals"."initial_circle_id" IS NULL AND "home_case_referrals"."first_look_community_id" IS NULL));
