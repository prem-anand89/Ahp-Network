CREATE TYPE "public"."credential_status" AS ENUM('pending', 'under_review', 'query_raised', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."credential_type" AS ENUM('degree', 'postgraduate_degree', 'council_registration');--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "credential_type" NOT NULL,
	"registration_number" text,
	"institution_id" uuid,
	"council_id" uuid,
	"document_url" text,
	"ocr_extracted_json" jsonb,
	"confidence_score" integer,
	"status" "credential_status" DEFAULT 'pending' NOT NULL,
	"query_message" text,
	"query_raised_at" timestamp with time zone,
	"query_raised_by_admin_id" uuid,
	"query_responded_at" timestamp with time zone,
	"expiry_date" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_institution_id_master_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."master_institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_council_id_master_councils_id_fk" FOREIGN KEY ("council_id") REFERENCES "public"."master_councils"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_query_raised_by_admin_id_admin_users_id_fk" FOREIGN KEY ("query_raised_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_verified_by_admin_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credentials_queue" ON "credentials" USING btree ("status","confidence_score") WHERE "credentials"."status" IN ('pending', 'under_review') AND "credentials"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "credentials_awaiting_therapist" ON "credentials" USING btree ("query_raised_at") WHERE "credentials"."status" = 'query_raised';--> statement-breakpoint
CREATE INDEX "credentials_by_user" ON "credentials" USING btree ("user_id") WHERE "credentials"."deleted_at" IS NULL;