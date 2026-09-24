-- Round 2 step 6 — pledges (plan decisions 1 & 2). One mechanism, two
-- targets: a waitlisted city signup (decision 1) or a user-proposed
-- community (decision 2). See src/db/schema.ts's comments on each table
-- for the full reasoning.

CREATE TABLE "community_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"proposed_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_community_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_proposals_status_check" CHECK ("status" IN ('open','created','declined'))
);
--> statement-breakpoint
ALTER TABLE "community_proposals" ADD CONSTRAINT "community_proposals_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id");
--> statement-breakpoint
CREATE INDEX "community_proposals_by_status" ON "community_proposals" USING btree ("status");
--> statement-breakpoint

ALTER TABLE "communities" ADD COLUMN "source_proposal_id" uuid;
--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_source_proposal_id_community_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."community_proposals"("id");
--> statement-breakpoint
ALTER TABLE "communities" DROP CONSTRAINT "communities_origin_check";
--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_origin_check" CHECK ("origin" IN ('platform_curated','auto_generated_institution','auto_generated_certification','auto_generated_practice','user_created','user_pledged'));
--> statement-breakpoint

CREATE TABLE "pledges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_city" text,
	"target_community_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pledges_target_type_check" CHECK ("target_type" IN ('city','community')),
	CONSTRAINT "pledges_target_shape" CHECK (("target_type" = 'city') = ("target_city" IS NOT NULL) AND ("target_type" = 'community') = ("target_community_proposal_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");
--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_target_community_proposal_id_community_proposals_id_fk" FOREIGN KEY ("target_community_proposal_id") REFERENCES "public"."community_proposals"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pledges_unique_city" ON "pledges" USING btree ("user_id","target_city") WHERE "target_city" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "pledges_unique_community" ON "pledges" USING btree ("user_id","target_community_proposal_id") WHERE "target_community_proposal_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "pledges_by_city" ON "pledges" USING btree ("target_city") WHERE "target_city" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "pledges_by_community" ON "pledges" USING btree ("target_community_proposal_id") WHERE "target_community_proposal_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "unlocked_cities" (
	"city" text PRIMARY KEY NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlocked_by_admin_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unlocked_cities" ADD CONSTRAINT "unlocked_cities_unlocked_by_admin_id_admin_users_id_fk" FOREIGN KEY ("unlocked_by_admin_id") REFERENCES "public"."admin_users"("id");
