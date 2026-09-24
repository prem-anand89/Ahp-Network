-- Round 3 — national place registry (plan: "Open to all of India").
--
-- Converts area_level from a fixed Postgres ENUM to TEXT + CHECK
-- (CLAUDE.md's convention for a field expected to grow): ALTER TYPE ...
-- ADD VALUE can't be used in the same transaction that adds it, and this
-- migration needs 'state' usable immediately (the Hyderabad reconcile
-- below inserts a state row). CHECK avoids the two-step problem outright.
ALTER TABLE "areas" ALTER COLUMN "area_level" SET DATA TYPE text USING "area_level"::text;
--> statement-breakpoint
DROP TYPE "area_level";
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_area_level_check" CHECK ("area_level" IN ('state','city','zone','locality'));
--> statement-breakpoint

ALTER TABLE "areas" ADD COLUMN "city_area_id" uuid;
--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "pincode" text;
--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "source" text DEFAULT 'seed_curated' NOT NULL;
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_source_check" CHECK ("source" IN ('seed_curated','india_post','therapist_added'));
--> statement-breakpoint

-- Self-referencing, same style as areas_parent_id_areas_id_fk (0006) —
-- RESTRICT, not CASCADE: a city row is never deleted out from under the
-- zones/localities that point at it.
ALTER TABLE "areas" ADD CONSTRAINT "areas_city_area_id_areas_id_fk" FOREIGN KEY ("city_area_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

-- Replaces the single global areas_slug_unique: a state/city slug is
-- unique nationwide, a zone/locality slug only within its own city (two
-- cities can each have a "west-zone").
DROP INDEX "areas_slug_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "areas_slug_unique_top_level" ON "areas" USING btree ("slug") WHERE "area_level" IN ('state','city');
--> statement-breakpoint
CREATE UNIQUE INDEX "areas_slug_unique_within_city" ON "areas" USING btree ("city_area_id","slug") WHERE "area_level" IN ('zone','locality');
--> statement-breakpoint

CREATE INDEX "areas_by_city" ON "areas" USING btree ("city_area_id");
--> statement-breakpoint
CREATE INDEX "areas_by_pincode" ON "areas" USING btree ("pincode") WHERE "pincode" IS NOT NULL;
--> statement-breakpoint
-- Trigram, same pattern as master_institutions_search (pg_trgm already
-- enabled, drizzle/0000) — typo-tolerant locality/city name search.
CREATE INDEX "areas_search" ON "areas" USING gin (lower("name") gin_trgm_ops);
--> statement-breakpoint

-- Backfill the pre-Round-3 rows. Every existing row is Hyderabad's own
-- tree, built by 0007 with exactly one level of zone under the city, so
-- ancestor_ids[1] is always the Hyderabad city id for a zone or locality
-- row — safe to read directly rather than walking parent_id.
UPDATE "areas" SET "city_area_id" = "id" WHERE "area_level" = 'city';
--> statement-breakpoint
UPDATE "areas" SET "city_area_id" = "ancestor_ids"[1] WHERE "area_level" IN ('zone', 'locality') AND "city_area_id" IS NULL;
--> statement-breakpoint

-- Reconcile Hyderabad into the national hierarchy: give it a Telangana
-- state parent, matching the shape every India Post-loaded city will
-- have (state → city → zone → locality).
DO $$
DECLARE
  v_telangana_id uuid;
  v_hyderabad_id uuid;
BEGIN
  SELECT id INTO v_hyderabad_id FROM areas WHERE area_level = 'city' AND slug = 'hyderabad';
  IF v_hyderabad_id IS NULL THEN
    RETURN; -- dev/test DBs that never ran the 0007 seed have nothing to reconcile
  END IF;

  INSERT INTO areas (id, name, slug, area_level, parent_id, ancestor_ids, source)
  VALUES (gen_random_uuid(), 'Telangana', 'telangana', 'state', NULL, '{}', 'seed_curated')
  RETURNING id INTO v_telangana_id;

  UPDATE areas SET parent_id = v_telangana_id, ancestor_ids = ARRAY[v_telangana_id]
  WHERE id = v_hyderabad_id;

  UPDATE areas SET ancestor_ids = ARRAY[v_telangana_id] || ancestor_ids
  WHERE area_level IN ('zone', 'locality') AND city_area_id = v_hyderabad_id;
END $$;
