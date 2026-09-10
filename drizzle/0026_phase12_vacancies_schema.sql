CREATE TABLE "vacancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"posted_by_user_id" uuid NOT NULL,
	"role_needed" text NOT NULL,
	"specialization" text,
	"area_id" uuid,
	"employment_type" text,
	"compensation_text" text,
	"description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reviewed_by_admin_id" uuid,
	"reviewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "vacancies_status_check" CHECK ("vacancies"."status" IN ('draft', 'pending_review', 'open', 'filled', 'closed', 'removed'))
);
--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vacancies_board" ON "vacancies" USING btree ("status","area_id","created_at") WHERE "vacancies"."deleted_at" IS NULL AND "vacancies"."status" = 'open';