ALTER TABLE "home_case_referrals" ADD COLUMN "initial_circle_id" uuid;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "circle_first_window" interval;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "circle_first_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_initial_circle_id_circles_id_fk" FOREIGN KEY ("initial_circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;