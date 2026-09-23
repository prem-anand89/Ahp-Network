-- Round 2 step 4b — First Look unification (plan decisions 7 and 8).
-- Circle-first (0039) generalizes to three target kinds: a circle the
-- poster owns, a community the poster belongs to, or one named therapist
-- (the "Refer Patient" CTA on a profile). Whatever the target, the
-- recipients are always the structured matching pool INTERSECTED with the
-- target — a target narrows who sees it first, never adds anyone the
-- matching filter excluded (CLAUDE.md: matching reads structured columns
-- only).
--
-- circle_first_window / circle_first_opened_at keep their names and now
-- mean "the First Look window" for every target kind: renaming them would
-- touch every reader for no behavioural gain. A referral is "in First
-- Look" exactly when circle_first_window IS NOT NULL AND
-- circle_first_opened_at IS NULL.
--
-- expand_to_network: whether the scheduler opens the referral to the full
-- matched pool once the window passes. Circle-first always did; a poster
-- referring one specific colleague may not want that.
--
-- The CHECKs make the invariants structural rather than application
-- discipline: at most one target; a target iff a window; a "don't expand"
-- only when there is a target to stay with; and never on an urgent
-- referral — an urgent case held back for one person or group is a
-- patient-harm vector (the same rule postReferralTx already enforced for
-- circles, now enforced by the database for every target kind).
ALTER TABLE "home_case_referrals" ADD COLUMN "first_look_community_id" uuid;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "first_look_therapist_id" uuid;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD COLUMN "expand_to_network" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_community_id_communities_id_fk" FOREIGN KEY ("first_look_community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_therapist_id_users_id_fk" FOREIGN KEY ("first_look_therapist_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_single_target" CHECK (num_nonnulls(initial_circle_id, first_look_community_id, first_look_therapist_id) <= 1);--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_window" CHECK ((num_nonnulls(initial_circle_id, first_look_community_id, first_look_therapist_id) = 1) = (circle_first_window IS NOT NULL));--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_expand" CHECK (expand_to_network OR num_nonnulls(initial_circle_id, first_look_community_id, first_look_therapist_id) = 1);--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_routine_only" CHECK (urgency = 'routine' OR num_nonnulls(initial_circle_id, first_look_community_id, first_look_therapist_id) = 0);
