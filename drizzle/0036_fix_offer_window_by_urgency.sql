-- Phase 4 — the countdown bug. shortlistCandidatesTx (src/lib/referral-actions.ts)
-- has only ever called `SELECT shortlist_referral($1, $2, $3::uuid[])` — three
-- arguments — so p_offer_window's hardcoded `DEFAULT INTERVAL '4 hours'`
-- applied to every referral regardless of urgency, while the UI
-- (referral-detail-actions.tsx's holdLabel) has always promised "30
-- minutes" for urgent and "1 hour" for routine. The countdown rendered a
-- number the copy never claimed.
--
-- Fixed inside the function rather than by adding a 4th argument at every
-- call site: the row this function already locks (v_ref) is the single
-- source of truth for urgency, so deriving the window from it here makes
-- the UI copy and the actual window structurally unable to drift apart
-- again, regardless of what any future caller does or doesn't pass.
-- p_offer_window keeps its position and stays a real override — every
-- existing call in referral-concurrency.test.ts that passes an explicit
-- window ('4 hours', '0 seconds', ...) for delay/lapse testing purposes
-- is unaffected; only the omitted-argument case changes behavior.
--
-- CREATE OR REPLACE, not DROP+CREATE: same name, same parameter count,
-- types, and order as the 0016 definition — only the DEFAULT literal and
-- the body change, both of which REPLACE allows without touching grants
-- or any dependent object.
CREATE OR REPLACE FUNCTION shortlist_referral(
  p_referral_id    UUID,
  p_poster_id      UUID,
  p_therapist_ids  UUID[],
  p_offer_window   INTERVAL DEFAULT NULL,
  p_test_delay     INTERVAL DEFAULT INTERVAL '0'   -- TEST SEAM, see 0016's note
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_ref            home_case_referrals%ROWTYPE;
  v_existing       INT;
  v_chosen         INT := coalesce(array_length(p_therapist_ids, 1), 0);
  v_updated        INT;
  v_offer_window   INTERVAL;
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

  -- [G4] 30 minutes for urgent, 1 hour for routine — matches
  -- referral-detail-actions.tsx's holdLabel exactly, both now reading the
  -- same underlying fact (v_ref.urgency) instead of two copies of a
  -- number that could silently drift apart. p_offer_window, when a
  -- caller actually passes one (tests only, in practice), still wins.
  v_offer_window := COALESCE(
    p_offer_window,
    CASE WHEN v_ref.urgency = 'urgent' THEN INTERVAL '30 minutes' ELSE INTERVAL '1 hour' END
  );

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

  v_offer_expires := now() + v_offer_window;

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
