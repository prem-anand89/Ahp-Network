CREATE TYPE "public"."peer_note_status" AS ENUM('visible', 'hidden_by_subject', 'removed_by_admin');--> statement-breakpoint
CREATE TABLE "peer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"referral_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" "peer_note_status" DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_notes_body_length_check" CHECK (char_length("peer_notes"."body") <= 240)
);
--> statement-breakpoint
ALTER TABLE "peer_notes" ADD CONSTRAINT "peer_notes_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_notes" ADD CONSTRAINT "peer_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_notes" ADD CONSTRAINT "peer_notes_referral_id_home_case_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."home_case_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "peer_notes_one_per_author_per_referral" ON "peer_notes" USING btree ("author_user_id","referral_id");--> statement-breakpoint
CREATE INDEX "peer_notes_by_subject" ON "peer_notes" USING btree ("subject_user_id","created_at" DESC NULLS LAST) WHERE "peer_notes"."status" = 'visible';