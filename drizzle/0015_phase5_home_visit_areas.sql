CREATE TABLE "home_visit_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "home_visit_areas" ADD CONSTRAINT "home_visit_areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_visit_areas" ADD CONSTRAINT "home_visit_areas_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "home_visit_areas_unique" ON "home_visit_areas" USING btree ("user_id","area_id") WHERE "home_visit_areas"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "home_visit_areas_by_area" ON "home_visit_areas" USING btree ("area_id") WHERE "home_visit_areas"."deleted_at" IS NULL;