CREATE TYPE "public"."community_post_status" AS ENUM('pending_review', 'published', 'removed');--> statement-breakpoint
CREATE TYPE "public"."community_post_type" AS ENUM('announcement', 'resource', 'event');--> statement-breakpoint
CREATE TYPE "public"."community_status" AS ENUM('active', 'pending_review', 'closed');--> statement-breakpoint
CREATE TYPE "public"."community_type" AS ENUM('platform_official', 'user_created');--> statement-breakpoint
CREATE TYPE "public"."onboarding_moment" AS ENUM('profile_preview_shown', 'locality_context_shown', 'verification_celebration_shown', 'share_card_generated');--> statement-breakpoint
CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"area_id" uuid,
	"specialization" "specialization_type",
	"type" "community_type" DEFAULT 'platform_official' NOT NULL,
	"status" "community_status" DEFAULT 'active' NOT NULL,
	"origin" text DEFAULT 'platform_curated' NOT NULL,
	"source_institution_id" uuid,
	"source_course_id" uuid,
	"source_practice_id" uuid,
	"created_by_user_id" uuid,
	"reviewed_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "communities_origin_check" CHECK ("communities"."origin" IN ('platform_curated','auto_generated_institution','auto_generated_certification','auto_generated_practice','user_created'))
);
--> statement-breakpoint
CREATE TABLE "community_post_likes" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_post_views" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"posted_by_user_id" uuid NOT NULL,
	"type" "community_post_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"status" "community_post_status" DEFAULT 'published' NOT NULL,
	"reviewed_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"inviter_practice_id" uuid,
	"code" text NOT NULL,
	"channel" text,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_onboarding_moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"moment" "onboarding_moment" NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_source_institution_id_master_institutions_id_fk" FOREIGN KEY ("source_institution_id") REFERENCES "public"."master_institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_source_course_id_master_courses_certifications_id_fk" FOREIGN KEY ("source_course_id") REFERENCES "public"."master_courses_certifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_likes" ADD CONSTRAINT "community_post_likes_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_likes" ADD CONSTRAINT "community_post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_views" ADD CONSTRAINT "community_post_views_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_views" ADD CONSTRAINT "community_post_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding_moments" ADD CONSTRAINT "user_onboarding_moments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_post_likes_pk" ON "community_post_likes" USING btree ("post_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_post_views_pk" ON "community_post_views" USING btree ("post_id","user_id");--> statement-breakpoint
CREATE INDEX "community_posts_feed" ON "community_posts" USING btree ("community_id","created_at") WHERE "community_posts"."status" = 'published';--> statement-breakpoint
CREATE INDEX "invites_by_inviter" ON "invites" USING btree ("inviter_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_by_code" ON "invites" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "user_onboarding_moments_once" ON "user_onboarding_moments" USING btree ("user_id","moment");

-- BUILD_SEQUENCE.md Phase 8 — the founding-cohort community: "one row,
-- origin = 'platform_curated'". Pulled forward from Phase 9 as the sole
-- exception to §2/§8E3's ≥100-therapist auto-generation gate. Seeded here
-- (idempotent — safe to re-run) rather than left for an admin to create by
-- hand, since the pilot cohort needs it live from day one.
INSERT INTO communities (name, slug, type, status, origin)
SELECT 'AHP Network Founding Cohort', 'founding-cohort', 'platform_official', 'active', 'platform_curated'
WHERE NOT EXISTS (SELECT 1 FROM communities WHERE slug = 'founding-cohort');