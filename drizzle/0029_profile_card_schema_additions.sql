ALTER TABLE "home_visit_areas" ADD COLUMN "is_primary" boolean;--> statement-breakpoint
ALTER TABLE "master_courses_certifications" ADD COLUMN "has_formal_exam_track" boolean;--> statement-breakpoint
ALTER TABLE "practice_users" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "home_visit_areas_one_primary" ON "home_visit_areas" USING btree ("user_id") WHERE "home_visit_areas"."is_primary" AND "home_visit_areas"."deleted_at" IS NULL;--> statement-breakpoint
-- Profile Card addendum §9 — backfill existing practice_users rows so
-- started_at is never NULL for an affiliation that predates this column.
-- created_at is the correct value for every row that exists today: this
-- column only produces a wrong date once someone adds a genuinely *past*
-- job after the fact, which cannot have happened before this migration
-- shipped since the entry flow to do so didn't exist yet.
UPDATE "practice_users" SET "started_at" = "created_at" WHERE "started_at" IS NULL;
