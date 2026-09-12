ALTER TABLE "home_case_referrals" ADD COLUMN "targeting_mode" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "target_circle_id" uuid;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "targeted_pool_size_at_post" integer;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "widen_to_pool_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "widened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_target_circle_id_circles_id_fk" FOREIGN KEY ("target_circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "home_case_referrals_pending_widen" ON "home_case_referrals" USING btree ("widen_to_pool_at") WHERE "home_case_referrals"."targeting_mode" = 'circle' AND "home_case_referrals"."status" = 'open' AND "home_case_referrals"."widened_at" IS NULL;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_targeting_mode_check" CHECK ("home_case_referrals"."targeting_mode" IN ('open','circle'));