-- Round 2 step 4a — the referral engine's window, pause, re-offer, extend
-- and decline changes. Hand-written: every statement here is a PL/pgSQL
-- function (CLAUDE.md: referral state transitions are single-statement
-- functions, never client-held transactions), which drizzle-kit neither
-- generates nor tracks in its snapshot.
--
-- Supersedes ARCHITECTURE_REVIEW.md §G4's 30min/1h hold (founder decision,
-- Round 2 plan decision 5): 2h urgent, 12h routine — and the routine clock
-- only runs during waking hours (07:00–22:00 Asia/Kolkata). Urgent never
-- pauses: a paused urgent case is a patient-harm vector, same reasoning as
-- circle-first being disabled for urgent.
--
-- Every CREATE OR REPLACE below declares SET search_path inline. 0036
-- replaced shortlist_referral without one, and CREATE OR REPLACE resets a
-- function's SET clauses, so 0018's search-path-hijacking fix had been
-- silently undone on that one function since 0036. Restored here, and
-- guarded by a test (referral-concurrency.test.ts) so it can't regress
-- quietly again.
--
-- New ERRCODE: AHP07 — offer already extended once this round.

-- ---------------------------------------------------------------------------
-- add_waking_time — p_start plus p_duration of *waking* time, where waking
-- is 07:00–22:00 in Asia/Kolkata. A start inside the overnight span begins
-- counting at the next 07:00. Computed in the named zone explicitly: the
-- database and Workers both run UTC, and IST has no DST, but spelling the
-- zone out keeps this correct without relying on either fact.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_waking_time(p_start TIMESTAMPTZ, p_duration INTERVAL)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_local     TIMESTAMP := p_start AT TIME ZONE 'Asia/Kolkata';
  v_remaining INTERVAL  := p_duration;
  v_day_start TIMESTAMP;
  v_day_end   TIMESTAMP;
  v_guard     INT := 0;
BEGIN
  IF p_duration <= INTERVAL '0' THEN
    RETURN p_start;
  END IF;

  LOOP
    v_guard := v_guard + 1;
    -- 15 waking hours a day; no caller passes anything close to this.
    IF v_guard > 400 THEN
      RAISE EXCEPTION 'add_waking_time: duration % too large', p_duration;
    END IF;

    v_day_start := date_trunc('day', v_local) + INTERVAL '7 hours';
    v_day_end   := date_trunc('day', v_local) + INTERVAL '22 hours';

    IF v_local < v_day_start THEN
      v_local := v_day_start;
    ELSIF v_local >= v_day_end THEN
      v_local := v_day_start + INTERVAL '1 day';
      CONTINUE;
    END IF;

    IF v_local + v_remaining <= v_day_end THEN
      RETURN (v_local + v_remaining) AT TIME ZONE 'Asia/Kolkata';
    END IF;

    v_remaining := v_remaining - (v_day_end - v_local);
    v_local := v_day_start + INTERVAL '1 day';
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- offer_deadline — the one place the window length lives. Urgent: 2h wall
-- clock. Routine: 12h of waking time. Called by shortlist_referral; kept
-- separate so the window is testable without a referral row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION offer_deadline(p_start TIMESTAMPTZ, p_urgency referral_urgency)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN p_urgency = 'urgent'
              THEN p_start + INTERVAL '2 hours'
              ELSE add_waking_time(p_start, INTERVAL '12 hours')
         END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- shortlist_referral — same signature, same lock, same 2-slot cap. Three
-- changes:
--
-- 1. Window: offer_deadline() (2h urgent / 12h waking routine) unless a
--    caller passes p_offer_window (tests only), which stays plain wall
--    clock so existing delay/lapse tests are unaffected.
--
-- 2. Re-Offer: a 'missed' interest is an eligible candidate alongside
--    'pending' (plan decision 6). 'declined' is not — that was an explicit
--    "can't take this one." Exactly one row per chosen therapist is
--    picked (pending preferred over missed, then most recent), so a
--    therapist holding both can't double-count against the all-or-nothing
--    rowcount check or collide on referral_one_active_interest_per_therapist.
--
-- 3. Adding to a live round never shortens it: if the referral is already
--    'shortlisted', the shared offer_expires_at only ever moves later
--    (GREATEST). A fresh round (from 'open') resets extended_once.
--
-- The notification dedupe key now carries reroute_count. Without it, a
-- re-offered therapist's key ('shortlist:{ref}:{therapist}') already
-- exists from their first offer and ON CONFLICT DO NOTHING silently drops
-- the second notification — the offer would open with nobody told.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shortlist_referral(
  p_referral_id    UUID,
  p_poster_id      UUID,
  p_therapist_ids  UUID[],
  p_offer_window   INTERVAL DEFAULT NULL,
  p_test_delay     INTERVAL DEFAULT INTERVAL '0'   -- TEST SEAM, see 0016's note
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref            home_case_referrals%ROWTYPE;
  v_existing       INT;
  v_chosen         INT := coalesce(array_length(p_therapist_ids, 1), 0);
  v_updated        INT;
  v_reoffered      INT;
  v_offer_expires  TIMESTAMPTZ;
  v_therapist      UUID;
BEGIN
  IF v_chosen = 0 THEN
    RAISE EXCEPTION 'no therapists chosen' USING ERRCODE = 'AHP01';
  END IF;

  -- The serialization point for the whole referral.
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

  IF p_test_delay > INTERVAL '0' THEN PERFORM pg_sleep(extract(epoch FROM p_test_delay)); END IF;

  -- Exactly 2 slots, never more (§8D, CLAUDE.md non-negotiable).
  IF v_existing + v_chosen > 2 THEN
    RAISE EXCEPTION 'shortlist cap: % already shortlisted, % chosen', v_existing, v_chosen
      USING ERRCODE = 'AHP01';
  END IF;

  WITH chosen AS (
    SELECT DISTINCT ON (therapist_user_id) id, status
      FROM referral_interest
     WHERE referral_id = p_referral_id
       AND therapist_user_id = ANY(p_therapist_ids)
       AND status IN ('pending','missed')
       AND deleted_at IS NULL
     ORDER BY therapist_user_id, (status = 'pending') DESC, updated_at DESC
  ), updated AS (
    UPDATE referral_interest ri
       SET status = 'shortlisted', shortlisted_at = now(), responded_at = NULL, updated_at = now()
      FROM chosen
     WHERE ri.id = chosen.id
    RETURNING chosen.status AS previous_status
  )
  SELECT count(*), count(*) FILTER (WHERE previous_status = 'missed')
    INTO v_updated, v_reoffered
    FROM updated;

  -- All-or-nothing: never partially shortlist (§8D).
  IF v_updated <> v_chosen THEN
    RAISE EXCEPTION 'one of your choices is no longer available' USING ERRCODE = 'AHP02';
  END IF;

  v_offer_expires := CASE
    WHEN p_offer_window IS NOT NULL THEN now() + p_offer_window
    ELSE offer_deadline(now(), v_ref.urgency)
  END;
  IF v_ref.status = 'shortlisted' AND v_ref.offer_expires_at IS NOT NULL THEN
    v_offer_expires := GREATEST(v_offer_expires, v_ref.offer_expires_at);
  END IF;

  UPDATE home_case_referrals
     SET status = 'shortlisted',
         offer_expires_at = v_offer_expires,
         extended_once = CASE WHEN v_ref.status = 'open' THEN false ELSE extended_once END,
         updated_at = now()
   WHERE id = p_referral_id;

  INSERT INTO referral_events (referral_id, event_type, actor_user_id, payload)
  VALUES (p_referral_id, 'shortlisted', p_poster_id,
          jsonb_build_object('therapist_ids', to_jsonb(p_therapist_ids),
                             're_offered', v_reoffered,
                             'offer_expires_at', v_offer_expires));

  FOREACH v_therapist IN ARRAY p_therapist_ids LOOP
    INSERT INTO notification_outbox (user_id, channel, template, payload, dedupe_key)
    VALUES (v_therapist, 'push', 'referral_offered',
            jsonb_build_object('referral_id', p_referral_id, 'expires_at', v_offer_expires),
            'shortlist:' || p_referral_id || ':' || v_therapist || ':' || v_ref.reroute_count)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'referral_id', p_referral_id, 'shortlisted', v_updated, 're_offered', v_reoffered,
    'offer_expires_at', v_offer_expires);
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- extend_offer — the poster buys the current round more time, once.
--
-- Per-round, not per-therapist: offer_expires_at is a single column on the
-- referral, shared by both shortlisted therapists, so there is no
-- per-offer clock to extend. extended_once resets when a fresh round
-- starts (shortlist_referral from 'open').
--
-- Extension is half the base window: +1h urgent (wall clock), +6h of
-- waking time routine. Only while 'shortlisted' and not yet expired —
-- an offer that has lapsed is lapse_offers()'s to resolve, not this
-- function's to resurrect. Same row lock as the other transitions, so
-- extend-vs-accept and extend-vs-lapse serialize.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION extend_offer(
  p_referral_id UUID,
  p_poster_id   UUID,
  p_test_delay  INTERVAL DEFAULT INTERVAL '0'      -- TEST SEAM
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref         home_case_referrals%ROWTYPE;
  v_new_expires TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_ref FROM home_case_referrals
   WHERE id = p_referral_id AND deleted_at IS NULL FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'AHP05';
  END IF;
  IF v_ref.posted_by_user_id <> p_poster_id THEN
    RAISE EXCEPTION 'not the poster' USING ERRCODE = 'AHP04';
  END IF;

  IF p_test_delay > INTERVAL '0' THEN PERFORM pg_sleep(extract(epoch FROM p_test_delay)); END IF;

  IF v_ref.status <> 'shortlisted' OR v_ref.offer_expires_at IS NULL OR v_ref.offer_expires_at <= now() THEN
    RAISE EXCEPTION 'offer is no longer open' USING ERRCODE = 'AHP05';
  END IF;
  IF v_ref.extended_once THEN
    RAISE EXCEPTION 'already extended' USING ERRCODE = 'AHP07';
  END IF;

  v_new_expires := CASE WHEN v_ref.urgency = 'urgent'
                        THEN v_ref.offer_expires_at + INTERVAL '1 hour'
                        ELSE add_waking_time(v_ref.offer_expires_at, INTERVAL '6 hours')
                   END;

  UPDATE home_case_referrals
     SET offer_expires_at = v_new_expires, extended_once = true, updated_at = now()
   WHERE id = p_referral_id;

  INSERT INTO referral_events (referral_id, event_type, actor_user_id, payload)
  VALUES (p_referral_id, 'offer_extended', p_poster_id,
          jsonb_build_object('previous_expires_at', v_ref.offer_expires_at,
                             'offer_expires_at', v_new_expires));

  INSERT INTO notification_outbox (user_id, channel, template, payload, dedupe_key)
  SELECT ri.therapist_user_id, 'push', 'referral_offer_extended',
         jsonb_build_object('referral_id', p_referral_id, 'expires_at', v_new_expires),
         'extended:' || p_referral_id || ':' || ri.therapist_user_id || ':' || v_ref.reroute_count
    FROM referral_interest ri
   WHERE ri.referral_id = p_referral_id AND ri.status = 'shortlisted' AND ri.deleted_at IS NULL
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object('referral_id', p_referral_id, 'offer_expires_at', v_new_expires);
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- decline_offer — [G2]'s "can't take this one," moved from a plain
-- application UPDATE into a locked function. The application version had
-- no status filter (it could overwrite an 'accepted' or 'not_selected' row
-- to 'declined') and never touched the referral row, so when both
-- shortlisted therapists declined the poster waited out the entire window
-- — 12 hours now, for routine — on an offer nobody could accept.
--
-- Declinable from 'pending' (a matched therapist saying "not for me"
-- before being picked — drops them from the poster's candidate list) or
-- 'shortlisted' (turning down a live offer). Never from 'accepted',
-- 'not_selected' or 'missed' — those are settled facts. If declining a
-- live offer leaves no shortlisted interest, the referral reopens
-- immediately with the same bookkeeping lapse_offers() does
-- (reroute_count, the admin escalation after 2 reroutes) and the poster
-- is told to choose again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION decline_offer(
  p_referral_id  UUID,
  p_interest_id  UUID,
  p_therapist_id UUID,
  p_test_delay   INTERVAL DEFAULT INTERVAL '0'     -- TEST SEAM
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref       home_case_referrals%ROWTYPE;
  v_declined  UUID;
  v_remaining INT;
BEGIN
  SELECT * INTO v_ref FROM home_case_referrals
   WHERE id = p_referral_id AND deleted_at IS NULL FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'referral not found' USING ERRCODE = 'AHP05';
  END IF;

  IF p_test_delay > INTERVAL '0' THEN PERFORM pg_sleep(extract(epoch FROM p_test_delay)); END IF;

  UPDATE referral_interest
     SET status = 'declined', responded_at = now(), updated_at = now()
   WHERE id = p_interest_id
     AND referral_id = p_referral_id
     AND therapist_user_id = p_therapist_id
     AND status IN ('pending','shortlisted')
     AND deleted_at IS NULL
  RETURNING id INTO v_declined;

  IF v_declined IS NULL THEN
    RAISE EXCEPTION 'offer is no longer open' USING ERRCODE = 'AHP05';
  END IF;

  INSERT INTO referral_events (referral_id, event_type, actor_user_id)
  VALUES (p_referral_id, 'declined', p_therapist_id);

  SELECT count(*) INTO v_remaining FROM referral_interest
   WHERE referral_id = p_referral_id AND status = 'shortlisted' AND deleted_at IS NULL;

  IF v_remaining > 0 OR v_ref.status <> 'shortlisted' THEN
    RETURN jsonb_build_object('outcome', 'declined', 'remaining', v_remaining);
  END IF;

  UPDATE home_case_referrals
     SET status = 'open', offer_expires_at = NULL, reroute_count = reroute_count + 1,
         expiry_stage = CASE WHEN reroute_count + 1 >= 2 THEN 'admin_alerted' ELSE 'none' END,
         updated_at = now()
   WHERE id = p_referral_id;

  INSERT INTO referral_events (referral_id, event_type, payload)
  VALUES (p_referral_id, 'offer_declined_reopened', jsonb_build_object('reroute_count', v_ref.reroute_count + 1));

  INSERT INTO notification_outbox (user_id, channel, template, payload, dedupe_key)
  VALUES (v_ref.posted_by_user_id, 'push', 'referral_declined_choose_again',
          jsonb_build_object('referral_id', p_referral_id),
          'declined_all:' || p_referral_id || ':' || v_ref.reroute_count)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  RETURN jsonb_build_object('outcome', 'reopened', 'remaining', 0);
END;
$$;
