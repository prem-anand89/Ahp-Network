CREATE TYPE "public"."contact_mode" AS ENUM('direct', 'relay');--> statement-breakpoint
CREATE TYPE "public"."notification_outbox_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."referral_urgency" AS ENUM('routine', 'urgent');--> statement-breakpoint
CREATE TABLE "home_case_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"urgency" "referral_urgency" DEFAULT 'routine' NOT NULL,
	"urgency_reason" text,
	"contact_mode" "contact_mode" DEFAULT 'relay' NOT NULL,
	"posted_by_user_id" uuid NOT NULL,
	"posted_by_practice_id" uuid,
	"posted_by_type" text NOT NULL,
	"role_needed" "role_needed_type" NOT NULL,
	"specialization_needed" "specialization_type" NOT NULL,
	"additional_context" text,
	"home_visit_required" boolean NOT NULL,
	"location_address" text,
	"area_id" uuid,
	"patient_summary" text,
	"patient_consent_recorded_at" timestamp with time zone,
	"consent_text_version" text,
	"shortlist_closes_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"contact_ack_deadline_at" timestamp with time zone,
	"confirm_deadline_at" timestamp with time zone,
	"expiry_stage" text DEFAULT 'none' NOT NULL,
	"reroute_count" integer DEFAULT 0 NOT NULL,
	"matched_pool_size_at_post" integer,
	"matching_algorithm_version" text DEFAULT 'v1' NOT NULL,
	"extended_once" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_case_referrals_status_check" CHECK ("home_case_referrals"."status" IN ('open','shortlisted','accepted','contact_acknowledged','completed','cancelled_by_poster','expired')),
	CONSTRAINT "home_case_referrals_expiry_stage_check" CHECK ("home_case_referrals"."expiry_stage" IN ('none','pool_expanded','admin_alerted','close_prompted')),
	CONSTRAINT "home_case_referrals_posted_by_type_check" CHECK ("home_case_referrals"."posted_by_type" IN ('therapist','practice'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notification_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_channel_check" CHECK ("notification_outbox"."channel" IN ('push','email'))
);
--> statement-breakpoint
CREATE TABLE "referral_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_id" uuid NOT NULL,
	"therapist_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"shortlisted_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_interest_status_check" CHECK ("referral_interest"."status" IN ('pending','shortlisted','accepted','not_selected','withdrawn','missed','declined'))
);
--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_posted_by_practice_id_practices_id_fk" FOREIGN KEY ("posted_by_practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_case_referrals" ADD CONSTRAINT "home_case_referrals_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referral_id_home_case_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."home_case_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_interest" ADD CONSTRAINT "referral_interest_referral_id_home_case_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."home_case_referrals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_interest" ADD CONSTRAINT "referral_interest_therapist_user_id_users_id_fk" FOREIGN KEY ("therapist_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "home_case_referrals_open_by_area" ON "home_case_referrals" USING btree ("area_id","status") WHERE "home_case_referrals"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_dedupe" ON "notification_outbox" USING btree ("dedupe_key") WHERE "notification_outbox"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "notification_outbox_claimable" ON "notification_outbox" USING btree ("next_attempt_at") WHERE "notification_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "referral_events_by_referral" ON "referral_events" USING btree ("referral_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_one_accepted" ON "referral_interest" USING btree ("referral_id") WHERE "referral_interest"."status" = 'accepted' AND "referral_interest"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_one_active_interest_per_therapist" ON "referral_interest" USING btree ("referral_id","therapist_user_id") WHERE "referral_interest"."status" IN ('pending','shortlisted','accepted') AND "referral_interest"."deleted_at" IS NULL;
--> statement-breakpoint

-- §8D's three referral state transitions, ported from the Phase 0.5 spike
-- (spike/sql/002_functions.sql), proven there against a real deployed
-- Worker over Hyperdrive — not written cold here (BUILD_SEQUENCE.md Phase
-- 6). Each is invoked by the application as ONE statement:
-- SELECT fn(...). That is the whole point: a single statement is atomic
-- regardless of pooling mode, which is what makes these safe over
-- Hyperdrive's transaction-mode pool and is why the earlier Supavisor
-- session-mode bypass was withdrawn in v19 (CLAUDE.md).
--
-- Error contract: every rejection RAISEs with a stable ERRCODE the caller
-- maps to §8D's display wording (see src/lib/referral-display.ts). Never
-- return a "failed" jsonb for a rejection — a RAISE is what rolls the
-- whole call back.
--
-- TEST SEAM: each function takes a trailing p_test_delay, defaulting to
-- zero and never passed by application code. It holds the critical window
-- open so the concurrency tests (src/db/referral-concurrency.test.ts)
-- produce real contention instead of depending on client round-trip
-- timing — without it a test can pass against a function with the row
-- lock removed, which the spike verified and is exactly the kind of test
-- that proves nothing. The negative control lives alongside those tests.
--
--   AHP01 shortlist cap exceeded        AHP04 not the poster
--   AHP02 a chosen therapist moved on   AHP05 referral not in required state
--   AHP03 lost the accept race          AHP06 idempotency key reused with a different request

DROP FUNCTION IF EXISTS shortlist_referral(UUID, UUID, UUID[], INTERVAL, INTERVAL);
DROP FUNCTION IF EXISTS accept_referral(UUID, UUID, UUID, TEXT, INTERVAL, INTERVAL);
DROP FUNCTION IF EXISTS lapse_offers(UUID, INTERVAL);

-- ---------------------------------------------------------------------------
-- shortlist_referral — poster picks up to 2 finalists. §8D.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shortlist_referral(
  p_referral_id    UUID,
  p_poster_id      UUID,
  p_therapist_ids  UUID[],
  p_offer_window   INTERVAL DEFAULT INTERVAL '4 hours',
  p_test_delay     INTERVAL DEFAULT INTERVAL '0'   -- TEST SEAM, see note above
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_ref            home_case_referrals%ROWTYPE;
  v_existing       INT;
  v_chosen         INT := coalesce(array_length(p_therapist_ids, 1), 0);
  v_updated        INT;
  v_offer_expires  TIMESTAMPTZ;
  v_therapist      UUID;
BEGIN
  IF v_chosen = 0 THEN
    RAISE EXCEPTION 'no therapists chosen' USING ERRCODE = 'AHP01';
  END IF;

  -- The serialization point for the whole referral. Everything below is
  -- protected by this lock; concurrent callers queue here.
  SELECT * INTO v_ref FROM home_case_referrals
   WHERE id = p_referral_id AND deleted_at IS NULL FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'AHP05';
  END IF;
  IF v_ref.posted_by_user_id <> p_poster_id THEN
    RAISE EXCEPTION 'not the poster' USING ERRCODE = 'AHP04';
  END IF;
  IF v_ref.status NOT IN ('open','shortlisted') THEN
    RAISE EXCEPTION 'referral is %, cannot shortlist', v_ref.status USING ERRCODE = 'AHP05';
  END IF;

  SELECT count(*) INTO v_existing FROM referral_interest
   WHERE referral_id = p_referral_id AND status = 'shortlisted' AND deleted_at IS NULL;

  -- Holds the check-and-write window open so concurrency tests are
  -- deterministic rather than dependent on client round-trip timing. Zero
  -- in every real call.
  IF p_test_delay > INTERVAL '0' THEN PERFORM pg_sleep(extract(epoch FROM p_test_delay)); END IF;

  -- Exactly 2 slots, never more (§8D, CLAUDE.md non-negotiable).
  IF v_existing + v_chosen > 2 THEN
    RAISE EXCEPTION 'shortlist cap: % already shortlisted, % chosen', v_existing, v_chosen
      USING ERRCODE = 'AHP01';
  END IF;

  UPDATE referral_interest
     SET status = 'shortlisted', shortlisted_at = now(), updated_at = now()
   WHERE referral_id = p_referral_id
     AND therapist_user_id = ANY(p_therapist_ids)
     AND status = 'pending'
     AND deleted_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- All-or-nothing: never partially shortlist. §8D is explicit about this.
  IF v_updated <> v_chosen THEN
    RAISE EXCEPTION 'one of your choices is no longer available' USING ERRCODE = 'AHP02';
  END IF;

  v_offer_expires := now() + p_offer_window;

  UPDATE home_case_referrals
     SET status = 'shortlisted', offer_expires_at = v_offer_expires, updated_at = now()
   WHERE id = p_referral_id;

  INSERT INTO referral_events (referral_id, event_type, actor_user_id, payload)
  VALUES (p_referral_id, 'shortlisted', p_poster_id,
          jsonb_build_object('therapist_ids', to_jsonb(p_therapist_ids)));

  -- Enqueued, never sent inline (§8D). dedupe_key makes a retried call a
  -- no-op rather than a second notification.
  FOREACH v_therapist IN ARRAY p_therapist_ids LOOP
    INSERT INTO notification_outbox (user_id, channel, template, payload, dedupe_key)
    VALUES (v_therapist, 'push', 'referral_offered',
            jsonb_build_object('referral_id', p_referral_id, 'expires_at', v_offer_expires),
            'shortlist:' || p_referral_id || ':' || v_therapist)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'referral_id', p_referral_id, 'shortlisted', v_updated,
    'offer_expires_at', v_offer_expires);
END;
$$;

-- ---------------------------------------------------------------------------
-- accept_referral — first to accept wins. §8D.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_referral(
  p_referral_id      UUID,
  p_interest_id      UUID,
  p_therapist_id     UUID,
  p_idempotency_key  TEXT,
  p_confirm_window   INTERVAL DEFAULT INTERVAL '24 hours',
  p_test_delay       INTERVAL DEFAULT INTERVAL '0'  -- TEST SEAM, see note above
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_ref        home_case_referrals%ROWTYPE;
  v_hash       TEXT := md5(p_referral_id::text || ':' || p_interest_id::text || ':' || p_therapist_id::text);
  v_stored     idempotency_keys%ROWTYPE;
  v_accepted   UUID;
  v_confirm_by TIMESTAMPTZ;
  v_result     JSONB;
BEGIN
  -- The idempotency check lives INSIDE the transaction (§8D A5). Checked
  -- in front of it, it would not guard the race it exists to guard — a
  -- double-tap on a flaky mobile connection can arrive genuinely
  -- concurrently.
  SELECT * INTO v_stored FROM idempotency_keys WHERE key = p_idempotency_key;
  IF FOUND THEN
    IF v_stored.request_hash <> v_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different request' USING ERRCODE = 'AHP06';
    END IF;
    RETURN v_stored.response_json;
  END IF;

  SELECT * INTO v_ref FROM home_case_referrals
   WHERE id = p_referral_id AND deleted_at IS NULL FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'AHP05';
  END IF;
  IF v_ref.status <> 'shortlisted' THEN
    RAISE EXCEPTION 'went to someone else' USING ERRCODE = 'AHP03';
  END IF;

  IF p_test_delay > INTERVAL '0' THEN PERFORM pg_sleep(extract(epoch FROM p_test_delay)); END IF;

  UPDATE referral_interest
     SET status = 'accepted', responded_at = now(), updated_at = now()
   WHERE id = p_interest_id
     AND referral_id = p_referral_id
     AND therapist_user_id = p_therapist_id
     AND status = 'shortlisted'
     AND deleted_at IS NULL
  RETURNING id INTO v_accepted;

  -- Zero rows ⇒ the other shortlisted therapist already accepted, or this
  -- offer lapsed. Either way this caller lost; roll the whole call back.
  IF v_accepted IS NULL THEN
    RAISE EXCEPTION 'went to someone else' USING ERRCODE = 'AHP03';
  END IF;

  -- The sibling is always closed out — never left dangling (§8D invariant 3).
  UPDATE referral_interest
     SET status = 'not_selected', responded_at = now(), updated_at = now()
   WHERE referral_id = p_referral_id AND status = 'shortlisted' AND id <> p_interest_id
     AND deleted_at IS NULL;

  v_confirm_by := now() + p_confirm_window;

  UPDATE home_case_referrals
     SET status = 'accepted', accepted_at = now(), confirm_deadline_at = v_confirm_by,
         updated_at = now()
   WHERE id = p_referral_id;

  INSERT INTO referral_events (referral_id, event_type, actor_user_id)
  VALUES (p_referral_id, 'accepted', p_therapist_id);

  INSERT INTO notification_outbox (user_id, channel, template, payload, dedupe_key)
  VALUES (v_ref.posted_by_user_id, 'push', 'referral_accepted',
          jsonb_build_object('referral_id', p_referral_id, 'therapist_id', p_therapist_id),
          'accepted:' || p_referral_id)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  -- [G3] Both numbers the losing message needs already exist by this
  -- point: who accepted, and out of how many interested. The wording
  -- itself lives in src/lib/referral-display.ts, not here — this only
  -- enqueues the notification with the payload that wording needs.
  INSERT INTO notification_outbox (user_id, channel, template, payload, dedupe_key)
  SELECT ri.therapist_user_id, 'push', 'referral_went_to_someone_else',
         jsonb_build_object('referral_id', p_referral_id, 'accepted_by_therapist_id', p_therapist_id),
         'not_selected:' || p_referral_id || ':' || ri.therapist_user_id
    FROM referral_interest ri
   WHERE ri.referral_id = p_referral_id AND ri.status = 'not_selected'
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  v_result := jsonb_build_object(
    'referral_id', p_referral_id, 'interest_id', v_accepted,
    'accepted_by', p_therapist_id, 'confirm_deadline_at', v_confirm_by);

  INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response_json)
  VALUES (p_idempotency_key, p_therapist_id, 'accept_referral', v_hash, v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- lapse_offers — the third transaction, undefined in v18. The sub-hourly
-- scheduler and a live accept can fire on the same referral in the same
-- second, so this needs the same lock discipline as the other two (§8D).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lapse_offers(
  p_referral_id UUID,
  p_test_delay  INTERVAL DEFAULT INTERVAL '0'      -- TEST SEAM, see note above
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_ref       home_case_referrals%ROWTYPE;
  v_lapsed    INT;
  v_remaining INT;
BEGIN
  SELECT * INTO v_ref FROM home_case_referrals
   WHERE id = p_referral_id AND deleted_at IS NULL FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- The accept already won (or the poster withdrew). No-op — never reopen
  -- or overwrite a referral that has moved on.
  IF v_ref.status <> 'shortlisted' THEN
    RETURN jsonb_build_object('outcome', 'noop', 'status', v_ref.status);
  END IF;

  IF v_ref.offer_expires_at IS NULL OR now() < v_ref.offer_expires_at THEN
    RETURN jsonb_build_object('outcome', 'not_yet_due');
  END IF;

  IF p_test_delay > INTERVAL '0' THEN PERFORM pg_sleep(extract(epoch FROM p_test_delay)); END IF;

  UPDATE referral_interest
     SET status = 'missed', responded_at = now(), updated_at = now()
   WHERE referral_id = p_referral_id AND status = 'shortlisted' AND deleted_at IS NULL;
  GET DIAGNOSTICS v_lapsed = ROW_COUNT;

  SELECT count(*) INTO v_remaining FROM referral_interest
   WHERE referral_id = p_referral_id AND status = 'shortlisted' AND deleted_at IS NULL;

  -- "Two shortlisted, one lapses → the other's offer stands untouched"
  -- (§8D). With one shared offer_expires_at both lapse together, but the
  -- branch is kept because per-offer expiry is a plausible later
  -- refinement.
  IF v_remaining > 0 THEN
    RETURN jsonb_build_object('outcome', 'partial_lapse', 'lapsed', v_lapsed);
  END IF;

  UPDATE home_case_referrals
     SET status = 'open', offer_expires_at = NULL, reroute_count = reroute_count + 1,
         expiry_stage = CASE WHEN reroute_count + 1 >= 2 THEN 'admin_alerted' ELSE 'none' END,
         updated_at = now()
   WHERE id = p_referral_id;

  INSERT INTO referral_events (referral_id, event_type, payload)
  VALUES (p_referral_id, 'offer_lapsed', jsonb_build_object('lapsed', v_lapsed));

  INSERT INTO notification_outbox (user_id, channel, template, payload, dedupe_key)
  VALUES (v_ref.posted_by_user_id, 'push', 'referral_missed_choose_again',
          jsonb_build_object('referral_id', p_referral_id),
          'missed:' || p_referral_id || ':' || v_ref.reroute_count)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object('outcome', 'reopened', 'lapsed', v_lapsed);
END;
$$;
