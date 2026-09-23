-- Round 2 step 3 — practice 2-way consent. practice_users gains a
-- five-state status (TEXT+CHECK, CLAUDE.md's growing-field convention)
-- replacing the three-state consent_status ENUM, so either side of an
-- affiliation — the practice (invite) or the therapist (request) — can
-- initiate, and the other accepts or declines. Backfill maps the old
-- (consent_status, asserted_by, ended_at) combination onto the new
-- vocabulary; nothing in application code writes 'pending' any more, so
-- this is a one-time historical mapping, not an ongoing dual-write.
ALTER TABLE "practice_users" ADD COLUMN "status" text;--> statement-breakpoint

UPDATE "practice_users" SET "status" = CASE
  WHEN "ended_at" IS NOT NULL THEN 'removed'
  WHEN "consent_status" = 'accepted' THEN 'active'
  WHEN "consent_status" = 'declined' THEN 'declined'
  WHEN "consent_status" = 'pending' AND "asserted_by" = 'practice' THEN 'invited'
  ELSE 'requested'
END;--> statement-breakpoint

ALTER TABLE "practice_users" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "practice_users" ADD CONSTRAINT "practice_users_status_check" CHECK (status IN ('invited', 'requested', 'active', 'declined', 'removed'));--> statement-breakpoint

DROP INDEX IF EXISTS "practice_users_public_accepted";--> statement-breakpoint

CREATE INDEX "practice_users_public_accepted" ON "practice_users" USING btree ("practice_id","is_public") WHERE (status = 'active' AND is_public = true AND ended_at IS NULL AND deleted_at IS NULL);--> statement-breakpoint

-- The one non-application-code reader of consent semantics: workplace
-- community membership (CLAUDE.md: derived live, never stored). Must
-- move to the new column BEFORE consent_status is dropped — the view
-- itself depends on that column, and Postgres refuses the DROP COLUMN
-- below until nothing references it any more.
CREATE OR REPLACE VIEW practice_community_members AS
SELECT c.id AS community_id, pu.user_id
FROM communities c
JOIN practice_users pu ON pu.practice_id = c.source_practice_id
WHERE c.origin = 'auto_generated_practice'
  AND c.deleted_at IS NULL
  AND pu.status = 'active'
  AND pu.ended_at IS NULL
  AND pu.deleted_at IS NULL;--> statement-breakpoint

ALTER TABLE "practice_users" DROP COLUMN "consent_status";--> statement-breakpoint

DROP TYPE IF EXISTS "public"."affiliation_consent_status";
