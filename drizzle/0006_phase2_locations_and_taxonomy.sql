CREATE TYPE "public"."area_level" AS ENUM('city', 'zone', 'locality');--> statement-breakpoint
CREATE TYPE "public"."council_type" AS ENUM('statutory_registration', 'professional_association');--> statement-breakpoint
CREATE TYPE "public"."course_category" AS ENUM('manual_therapy', 'exercise_therapeutic', 'electrotherapy_modalities', 'other');--> statement-breakpoint
CREATE TYPE "public"."course_tier" AS ENUM('diploma', 'international_accredited_certification', 'other_workshop');--> statement-breakpoint
CREATE TYPE "public"."curation_status" AS ENUM('approved', 'pending_review');--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"area_level" "area_level" NOT NULL,
	"parent_id" uuid,
	"ancestor_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"master_course_id" uuid,
	"custom_course_name" text,
	"provider_name" text,
	"duration_days" integer DEFAULT 2 NOT NULL,
	"credit_hours" text,
	"has_passed_exam" boolean DEFAULT false NOT NULL,
	"calculated_tier" "course_tier",
	"calculated_nomenclature" text,
	"certificate_url" text,
	"completion_year" integer,
	"curation_status" "curation_status" DEFAULT 'pending_review' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_councils" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"council_type" "council_type" NOT NULL,
	"state" text,
	"applicable_role" "role_needed_type",
	"registration_number_pattern" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_courses_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" "course_category" NOT NULL,
	"tier" "course_tier" NOT NULL,
	"nomenclature" text NOT NULL,
	"eligible_for_community_auto_generation" boolean DEFAULT false NOT NULL,
	"logo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"normalized_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hand-added: a self-referencing FK on a not-yet-generated column, which
-- drizzle-kit's declarative schema can't express without a circular
-- reference in schema.ts. Deleting a parent zone must not silently orphan
-- its localities.
ALTER TABLE "areas" ADD CONSTRAINT "areas_parent_id_areas_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_completions" ADD CONSTRAINT "course_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_completions" ADD CONSTRAINT "course_completions_master_course_id_master_courses_certifications_id_fk" FOREIGN KEY ("master_course_id") REFERENCES "public"."master_courses_certifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "areas_slug_unique" ON "areas" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "areas_by_parent" ON "areas" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "areas_ancestor_ids" ON "areas" USING gin ("ancestor_ids");--> statement-breakpoint
CREATE INDEX "course_completions_by_user" ON "course_completions" USING btree ("user_id") WHERE "course_completions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "course_completions_curation_queue" ON "course_completions" USING btree ("curation_status") WHERE "course_completions"."curation_status" = 'pending_review' AND "course_completions"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "master_courses_certifications_search" ON "master_courses_certifications" USING gin ("normalized_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "master_institutions_search" ON "master_institutions" USING gin ("normalized_name" gin_trgm_ops);