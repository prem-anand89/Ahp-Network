CREATE TYPE "public"."therapist_skill_verification_status" AS ENUM('unverified', 'pending', 'verified');--> statement-breakpoint
CREATE TABLE "contact_reveals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"revealed_to_user_id" uuid NOT NULL,
	"revealed_data" jsonb NOT NULL,
	"ip_address" "inet",
	"consent_timestamp" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "therapist_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_name" text NOT NULL,
	"category" text,
	"competency" text DEFAULT 'practicing' NOT NULL,
	"proof_url" text,
	"verification_status" "therapist_skill_verification_status" DEFAULT 'unverified' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "therapist_skills_verification_status_frozen" CHECK ("therapist_skills"."verification_status" = 'unverified')
);
--> statement-breakpoint
ALTER TABLE "contact_reveals" ADD CONSTRAINT "contact_reveals_referral_id_home_case_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."home_case_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_reveals" ADD CONSTRAINT "contact_reveals_revealed_to_user_id_users_id_fk" FOREIGN KEY ("revealed_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "therapist_skills" ADD CONSTRAINT "therapist_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "therapist_skills_by_user" ON "therapist_skills" USING btree ("user_id");