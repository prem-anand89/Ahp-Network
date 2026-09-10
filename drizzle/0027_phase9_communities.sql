CREATE TYPE "public"."community_moderator_status" AS ENUM('pending', 'approved', 'revoked');--> statement-breakpoint
CREATE TABLE "community_members" (
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_moderators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "community_moderator_status" DEFAULT 'pending' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_admin_id" uuid,
	"reviewed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_admin_id" uuid
);
--> statement-breakpoint
ALTER TABLE "master_institutions" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderators" ADD CONSTRAINT "community_moderators_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderators" ADD CONSTRAINT "community_moderators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderators" ADD CONSTRAINT "community_moderators_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderators" ADD CONSTRAINT "community_moderators_revoked_by_admin_id_admin_users_id_fk" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_members_pk" ON "community_members" USING btree ("community_id","user_id");--> statement-breakpoint
CREATE INDEX "community_members_by_user" ON "community_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_moderators_one_active" ON "community_moderators" USING btree ("community_id","user_id") WHERE "community_moderators"."status" IN ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "community_moderators_queue" ON "community_moderators" USING btree ("status") WHERE "community_moderators"."status" = 'pending';--> statement-breakpoint

-- §8E3 — workplace community membership is never stored. It's derived
-- live from practice_users, so a therapist leaving a practice (or a
-- pending affiliation never being accepted) automatically falls out of
-- the community in the same transaction that changes practice_users,
-- with nothing here to keep in sync. ahp_app's default privileges
-- (drizzle/0001) already cover views created after that migration, so no
-- separate GRANT is needed for this one.
CREATE VIEW practice_community_members AS
SELECT c.id AS community_id, pu.user_id
FROM communities c
JOIN practice_users pu ON pu.practice_id = c.source_practice_id
WHERE c.origin = 'auto_generated_practice'
  AND c.deleted_at IS NULL
  AND pu.consent_status = 'accepted'
  AND pu.ended_at IS NULL
  AND pu.deleted_at IS NULL;