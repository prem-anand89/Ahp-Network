CREATE TYPE "public"."feedback_category" AS ENUM('bug', 'feature_request', 'verification_issue', 'content_issue', 'grievance', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'triaged', 'planned', 'shipped', 'wont_do');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"category" "feedback_category" NOT NULL,
	"message" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact_ok" boolean DEFAULT false NOT NULL,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"admin_notes" text,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_message_length_check" CHECK (char_length("feedback"."message") BETWEEN 5 AND 4000)
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_triage" ON "feedback" USING btree ("status","created_at" DESC NULLS LAST);

-- §8G5 — default false: "do not publish any grievance address until §15A
-- clears and a named admin is checking the inbox." Idempotent seed.
INSERT INTO app_settings (key, value)
SELECT 'grievance_channel_published', 'false'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'grievance_channel_published');