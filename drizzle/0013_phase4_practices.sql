CREATE TYPE "public"."affiliation_asserted_by" AS ENUM('self', 'practice');--> statement-breakpoint
CREATE TYPE "public"."affiliation_consent_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."practice_access_role" AS ENUM('owner', 'manager', 'staff');--> statement-breakpoint
CREATE TYPE "public"."practice_claim_status" AS ENUM('submitted', 'under_review', 'query_raised', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."practice_relationship_type" AS ENUM('owns', 'works_at', 'visits');--> statement-breakpoint
CREATE TABLE "practice_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"claimant_user_id" uuid NOT NULL,
	"claimed_relationship" text NOT NULL,
	"document_url" text NOT NULL,
	"registration_number" text,
	"status" "practice_claim_status" DEFAULT 'submitted' NOT NULL,
	"query_message" text,
	"reviewed_by_admin_id" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_claims_relationship_check" CHECK ("practice_claims"."claimed_relationship" IN ('owner', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "practice_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"access_role" "practice_access_role" NOT NULL,
	"relationship_type" "practice_relationship_type" NOT NULL,
	"consent_status" "affiliation_consent_status" DEFAULT 'pending' NOT NULL,
	"asserted_by" "affiliation_asserted_by" NOT NULL,
	"disputed_at" timestamp with time zone,
	"disputed_by_user_id" uuid,
	"is_public" boolean DEFAULT false NOT NULL,
	"display_title" text,
	"ended_at" timestamp with time zone,
	"ended_by_user_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"slug" text,
	"google_place_id" text,
	"formatted_address" text,
	"latitude" double precision,
	"longitude" double precision,
	"normalized_name" text,
	"normalized_address" text,
	"registration_number" text,
	"created_by_user_id" uuid NOT NULL,
	"claim_status" text DEFAULT 'unclaimed' NOT NULL,
	"claimed_by_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"possible_duplicate_of" uuid,
	"noindex" boolean DEFAULT true NOT NULL,
	"logo_url" text,
	"cover_image_url" text,
	"bio" text,
	"services_offered" text[],
	"specialties" text[],
	"equipment_available" jsonb,
	"website_url" text,
	"phone" text,
	"email" text,
	"og_image_url" text,
	"qr_code_url" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practices_claim_status_check" CHECK ("practices"."claim_status" IN ('unclaimed', 'claim_pending', 'claimed', 'disputed')),
	CONSTRAINT "practices_type_check" CHECK ("practices"."type" IN ('clinic', 'hospital_department', 'home_care_agency', 'wellness_center', 'other'))
);
--> statement-breakpoint
ALTER TABLE "practice_claims" ADD CONSTRAINT "practice_claims_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_claims" ADD CONSTRAINT "practice_claims_claimant_user_id_users_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_claims" ADD CONSTRAINT "practice_claims_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_users" ADD CONSTRAINT "practice_users_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_users" ADD CONSTRAINT "practice_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_users" ADD CONSTRAINT "practice_users_disputed_by_user_id_users_id_fk" FOREIGN KEY ("disputed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_users" ADD CONSTRAINT "practice_users_ended_by_user_id_users_id_fk" FOREIGN KEY ("ended_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practices" ADD CONSTRAINT "practices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practices" ADD CONSTRAINT "practices_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-added: self-referencing FK, same reasoning as areas.parent_id in
-- drizzle/0006 -- drizzle-kit can't express a circular reference from
-- schema.ts without a callback. SET NULL rather than restrict: deleting
-- the original practice a duplicate points at should not block that
-- delete, it should just clear the pointer.
ALTER TABLE "practices" ADD CONSTRAINT "practices_possible_duplicate_of_practices_id_fk" FOREIGN KEY ("possible_duplicate_of") REFERENCES "public"."practices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "practice_claims_one_open_per_claimant" ON "practice_claims" USING btree ("practice_id","claimant_user_id") WHERE "practice_claims"."status" IN ('submitted', 'under_review', 'query_raised');--> statement-breakpoint
CREATE INDEX "practice_claims_queue" ON "practice_claims" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "practice_users_by_practice" ON "practice_users" USING btree ("practice_id") WHERE "practice_users"."deleted_at" IS NULL AND "practice_users"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "practice_users_by_user" ON "practice_users" USING btree ("user_id") WHERE "practice_users"."deleted_at" IS NULL AND "practice_users"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "practice_users_public_accepted" ON "practice_users" USING btree ("practice_id","is_public") WHERE "practice_users"."consent_status" = 'accepted' AND "practice_users"."is_public" = true AND "practice_users"."ended_at" IS NULL AND "practice_users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "practices_unique_place" ON "practices" USING btree ("google_place_id") WHERE "practices"."google_place_id" IS NOT NULL AND "practices"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "practices_dedupe_candidates" ON "practices" USING btree ("normalized_name","normalized_address") WHERE "practices"."deleted_at" IS NULL;