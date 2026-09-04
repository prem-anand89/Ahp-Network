CREATE TABLE "profile_contact_reveals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_user_id" uuid NOT NULL,
	"ip_hash" text NOT NULL,
	"user_agent" text,
	"revealed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "profile_contact_reveals" ADD CONSTRAINT "profile_contact_reveals_profile_user_id_users_id_fk" FOREIGN KEY ("profile_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_contact_reveals_rate" ON "profile_contact_reveals" USING btree ("ip_hash","revealed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "profile_contact_reveals_by_profile" ON "profile_contact_reveals" USING btree ("profile_user_id","revealed_at" DESC NULLS LAST);