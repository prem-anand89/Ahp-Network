-- Round 3 step E — stage 2 of 2 (see 0055's header for why this is
-- split). By this point every remaining pledges/unlocked_cities row has
-- a populated *_area_id (0055 backfilled by name and dropped anything
-- that didn't map), so it's now safe to drop the old text columns and
-- make city_area_id the real primary key.
ALTER TABLE "unlocked_cities" DROP CONSTRAINT "unlocked_cities_pkey";--> statement-breakpoint
ALTER TABLE "unlocked_cities" ALTER COLUMN "city_area_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "unlocked_cities" ADD PRIMARY KEY ("city_area_id");--> statement-breakpoint

-- Dropping target_city implicitly drops pledges_target_shape (it
-- referenced the column) and the two target_city indexes (they were on
-- it) -- Postgres auto-drops a constraint/index that depends solely on
-- the column being dropped, no CASCADE needed to trigger it. Recreated
-- below against target_city_area_id, the same shapes 0055 already gave
-- pledges_unique_community/pledges_by_community.
ALTER TABLE "pledges" DROP COLUMN "target_city";--> statement-breakpoint
ALTER TABLE "unlocked_cities" DROP COLUMN "city";--> statement-breakpoint

ALTER TABLE "pledges" ADD CONSTRAINT "pledges_target_shape" CHECK (("pledges"."target_type" = 'city') = ("pledges"."target_city_area_id" IS NOT NULL) AND ("pledges"."target_type" = 'community') = ("pledges"."target_community_proposal_id" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "pledges_unique_city" ON "pledges" USING btree ("user_id","target_city_area_id") WHERE "pledges"."target_city_area_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pledges_by_city" ON "pledges" USING btree ("target_city_area_id") WHERE "pledges"."target_city_area_id" IS NOT NULL;--> statement-breakpoint

-- Round 3 step E — 'waitlisted' is retired (schema.ts's own comment):
-- everyone signs up and is listed nationally immediately now, so nothing
-- blocks completing onboarding. No CHECK constraint exists on this
-- column (a plain text column with a TS-level literal hint only), so
-- only the data needs fixing, not the column definition.
UPDATE "users" SET "profile_status" = 'draft' WHERE "profile_status" = 'waitlisted';

