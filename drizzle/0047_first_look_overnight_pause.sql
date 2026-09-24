-- Round 2 follow-up (review item #4) — First Look's 4-hour window ran on
-- raw wall-clock time (created_at + circle_first_window), unlike the
-- routine offer window (add_waking_time, drizzle/0045). A referral posted
-- at 9pm reached its circle/community/named therapist with the window
-- almost entirely gone before anyone's push even arrives (routine push is
-- itself held until 7am by quiet-hours deferral) — the two windows need
-- to agree on what "waiting" means.
--
-- circle_first_opens_at stores the actual target open time, computed once
-- at post time via add_waking_time() (same helper the offer window uses),
-- rather than recomputed from created_at + circle_first_window on every
-- scheduler pass — a plain column the scheduler can index and compare
-- directly. circle_first_window itself is kept: still informative (how
-- long First Look asked for), and still what the CHECK constraints
-- (drizzle/0046) key off to detect "a target was chosen."
ALTER TABLE "home_case_referrals" ADD COLUMN "circle_first_opens_at" timestamp with time zone;--> statement-breakpoint

-- Backfill for any existing First-Look row: a plain add, not
-- waking-time-aware — these already happened, so this is a one-time
-- historical record, not an ongoing computation.
UPDATE "home_case_referrals"
   SET "circle_first_opens_at" = "created_at" + "circle_first_window"
 WHERE "circle_first_window" IS NOT NULL AND "circle_first_opens_at" IS NULL;--> statement-breakpoint

ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_first_look_opens_at" CHECK ((circle_first_window IS NOT NULL) = (circle_first_opens_at IS NOT NULL));
