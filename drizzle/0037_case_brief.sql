ALTER TABLE "home_case_referrals" ADD COLUMN "case_brief" jsonb;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "case_brief_written_at" timestamp with time zone;