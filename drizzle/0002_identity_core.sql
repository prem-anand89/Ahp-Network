CREATE TYPE "public"."account_type" AS ENUM('therapist', 'practice_manager', 'staff');--> statement-breakpoint
CREATE TYPE "public"."acting_context" AS ENUM('therapist', 'admin');--> statement-breakpoint
CREATE TYPE "public"."admin_role_type" AS ENUM('super_admin', 'verification_admin', 'grievance_officer', 'support_admin', 'referral_ops_admin', 'technical_admin');--> statement-breakpoint
CREATE TYPE "public"."age_group_type" AS ENUM('pediatric', 'adult', 'geriatric');--> statement-breakpoint
CREATE TYPE "public"."gender_type" AS ENUM('male', 'female', 'non_binary', 'prefer_not_to_say');--> statement-breakpoint
CREATE TYPE "public"."profile_verification_stage" AS ENUM('unverified', 'qualification_confirmed', 'credentials_verified');--> statement-breakpoint
CREATE TYPE "public"."role_needed_type" AS ENUM('physiotherapist', 'occupational_therapist', 'speech_language_pathologist');--> statement-breakpoint
CREATE TYPE "public"."specialization_type" AS ENUM('musculoskeletal_orthopaedic', 'neuro_rehab');--> statement-breakpoint
CREATE TABLE "admin_user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"role" "admin_role_type" NOT NULL,
	"assigned_by_admin_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"acting_context" "acting_context",
	"action" text NOT NULL,
	"target_table" text,
	"target_id" uuid,
	"outcome" text NOT NULL,
	"correlation_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"email_at_link" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"slug" text,
	"profile_visibility" text DEFAULT 'hidden' NOT NULL,
	"profile_status" text DEFAULT 'draft' NOT NULL,
	"account_type" "account_type" DEFAULT 'therapist' NOT NULL,
	"legal_name" text,
	"display_name" text,
	"role" "role_needed_type",
	"specializations" "specialization_type"[] DEFAULT '{}'::specialization_type[] NOT NULL,
	"gender" "gender_type",
	"age_groups_served" "age_group_type"[] DEFAULT '{}'::age_group_type[] NOT NULL,
	"bio" text,
	"years_experience" integer,
	"tele_rehab_available" boolean DEFAULT false NOT NULL,
	"languages" text[],
	"accepts_clinic_visits" boolean DEFAULT true NOT NULL,
	"accepts_home_visits" boolean DEFAULT true NOT NULL,
	"accepting_referrals" boolean DEFAULT true NOT NULL,
	"availability_notes" text,
	"available_for_new_patients" boolean DEFAULT false NOT NULL,
	"availability_updated_at" timestamp with time zone,
	"verification_stage" "profile_verification_stage" DEFAULT 'unverified' NOT NULL,
	"public_contact_value" jsonb,
	"contact_preference" text DEFAULT 'none' NOT NULL,
	"open_to_opportunities" boolean DEFAULT false NOT NULL,
	"referral_code" text,
	"invited_by_user_id" uuid,
	"is_founding_member" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_assigned_by_admin_id_admin_users_id_fk" FOREIGN KEY ("assigned_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_revoked_by_admin_id_admin_users_id_fk" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_user_roles_active_unique" ON "admin_user_roles" USING btree ("admin_user_id","role") WHERE "admin_user_roles"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "admin_user_roles_by_role" ON "admin_user_roles" USING btree ("role") WHERE "admin_user_roles"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_account" ON "auth_identities" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "auth_identities_by_user" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_active_slug" ON "users" USING btree ("slug") WHERE "users"."profile_status" = 'active' AND "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "users_directory" ON "users" USING btree ("account_type","verification_stage") WHERE "users"."deleted_at" IS NULL AND "users"."account_type" = 'therapist';--> statement-breakpoint
CREATE INDEX "users_specializations" ON "users" USING gin ("specializations");--> statement-breakpoint
-- users.id equals auth.users.id (plan §8A) — the FK to Supabase Auth's own
-- table, added by hand since Drizzle doesn't model cross-schema references.
-- ON DELETE CASCADE: if a Supabase Auth identity is ever hard-deleted, the
-- corresponding row here goes too rather than becoming an orphan with a
-- dangling id nothing can look up.
ALTER TABLE "users" ADD CONSTRAINT "users_id_auth_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
