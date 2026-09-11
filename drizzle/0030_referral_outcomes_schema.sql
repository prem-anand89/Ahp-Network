CREATE TABLE "referral_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"sent_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_status_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"reported_by_user_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"discontinued_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "referral_status_updates_outcome_check" CHECK ("referral_status_updates"."outcome" IN ('no_patient_contact','contacted_not_started','first_session_done','ongoing','completed_discharged','discontinued','not_suitable_referred_on')),
	CONSTRAINT "referral_status_updates_reason_required_check" CHECK (("referral_status_updates"."outcome" = 'discontinued') = ("referral_status_updates"."discontinued_reason" IS NOT NULL)),
	CONSTRAINT "referral_status_updates_reason_values_check" CHECK ("referral_status_updates"."discontinued_reason" IS NULL OR "referral_status_updates"."discontinued_reason" IN ('switched_therapist','not_responding','cost','travel_distance','improved','mismatch','not_comfortable','medical_reason','relocated','other')),
	CONSTRAINT "referral_status_updates_note_check" CHECK ("referral_status_updates"."note" IS NULL OR (char_length("referral_status_updates"."note") <= 500 AND ("referral_status_updates"."outcome" IN ('ongoing','completed_discharged','not_suitable_referred_on') OR ("referral_status_updates"."outcome" = 'discontinued' AND "referral_status_updates"."discontinued_reason" IN ('medical_reason','other')))))
);
--> statement-breakpoint
ALTER TABLE "home_case_referrals" DROP CONSTRAINT "home_case_referrals_status_check";--> statement-breakpoint
ALTER TABLE "referral_nudges" ADD CONSTRAINT "referral_nudges_referral_id_home_case_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."home_case_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_nudges" ADD CONSTRAINT "referral_nudges_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_status_updates" ADD CONSTRAINT "referral_status_updates_referral_id_home_case_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."home_case_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_status_updates" ADD CONSTRAINT "referral_status_updates_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referral_nudges_by_referral" ON "referral_nudges" USING btree ("referral_id","created_at");--> statement-breakpoint
CREATE INDEX "referral_status_updates_by_referral" ON "referral_status_updates" USING btree ("referral_id","created_at") WHERE "referral_status_updates"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_status_check" CHECK ("home_case_referrals"."status" IN ('open','shortlisted','accepted','contact_acknowledged','completed','cancelled_by_poster','expired','auto_closed'));