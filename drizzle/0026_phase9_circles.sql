CREATE TABLE "circle_members" (
	"circle_id" uuid NOT NULL,
	"therapist_user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "circles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_therapist_user_id_users_id_fk" FOREIGN KEY ("therapist_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circles" ADD CONSTRAINT "circles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "circle_members_pk" ON "circle_members" USING btree ("circle_id","therapist_user_id");--> statement-breakpoint
CREATE INDEX "circle_members_by_therapist" ON "circle_members" USING btree ("therapist_user_id");--> statement-breakpoint
CREATE INDEX "circles_by_owner" ON "circles" USING btree ("owner_user_id") WHERE "circles"."deleted_at" IS NULL;