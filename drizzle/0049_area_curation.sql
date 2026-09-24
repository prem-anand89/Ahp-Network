-- Step 5 — areas outside the curated tree (bounded to Hyderabad metro,
-- plan decision 11). Same curation_status enum already used by
-- master_institutions/master_councils/course_completions; reused here
-- rather than a new type. isActive stays true for a pending row —
-- curation_status is the read-time gate, applied explicitly in
-- referral-matching.ts, directory.ts and areas.ts (getAreaZones), same
-- discipline as the other curated tables.
ALTER TABLE "areas" ADD COLUMN "curation_status" curation_status DEFAULT 'approved' NOT NULL;--> statement-breakpoint

ALTER TABLE "areas" ADD COLUMN "google_place_id" text;--> statement-breakpoint

CREATE UNIQUE INDEX "areas_google_place_id_unique" ON "areas" USING btree ("google_place_id") WHERE "google_place_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "areas_curation_queue" ON "areas" USING btree ("curation_status") WHERE "curation_status" = 'pending_review';
