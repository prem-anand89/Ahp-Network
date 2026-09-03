// Phase 0.5 spike schema + functions, embedded as strings since a Worker has
// no filesystem at runtime. Source of truth is spike/sql/001_schema.sql and
// 002_functions.sql — keep these in sync if those change.

export const SETUP_SQL = `
CREATE SCHEMA IF NOT EXISTS phase05_spike;
SET search_path TO phase05_spike;

DROP SCHEMA phase05_spike CASCADE;
CREATE SCHEMA phase05_spike;
SET search_path TO phase05_spike;

CREATE TABLE users (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL
);

CREATE TABLE home_case_referrals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status              TEXT NOT NULL DEFAULT 'open' CHECK (
                        status IN ('open','shortlisted','accepted','contact_acknowledged',
                                   'completed','cancelled_by_poster','expired')),
  urgency             TEXT NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine','urgent')),
  posted_by_user_id   UUID NOT NULL REFERENCES users(id),
  offer_expires_at    TIMESTAMPTZ,
  confirm_deadline_at TIMESTAMPTZ,
  accepted_at         TIMESTAMPTZ,
  expiry_stage        TEXT NOT NULL DEFAULT 'none' CHECK (
                        expiry_stage IN ('none','pool_expanded','admin_alerted','close_prompted')),
  reroute_count       INT NOT NULL DEFAULT 0,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE referral_interest (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id       UUID NOT NULL REFERENCES home_case_referrals(id),
  therapist_user_id UUID NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (
                      status IN ('pending','shortlisted','accepted','not_selected','withdrawn','missed')),
  shortlisted_at    TIMESTAMPTZ,
  responded_at      TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX referral_one_accepted
  ON referral_interest (referral_id) WHERE status = 'accepted' AND deleted_at IS NULL;
CREATE UNIQUE INDEX referral_one_active_interest_per_therapist
  ON referral_interest (referral_id, therapist_user_id)
  WHERE status IN ('pending','shortlisted','accepted') AND deleted_at IS NULL;

CREATE TABLE referral_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id   UUID NOT NULL REFERENCES home_case_referrals(id),
  event_type    TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  payload       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_outbox (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  channel           TEXT NOT NULL CHECK (channel IN ('push','email')),
  template          TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempt_count     INT NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at         TIMESTAMPTZ,
  dedupe_key        TEXT,
  last_attempted_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notification_outbox_dedupe
  ON notification_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_outbox_claimable
  ON notification_outbox (next_attempt_at) WHERE status = 'pending';

CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const FUNCTIONS_SQL = `
SET search_path TO phase05_spike;

DROP FUNCTION IF EXISTS shortlist_referral(UUID, UUID, UUID[], INTERVAL, INTERVAL);
DROP FUNCTION IF EXISTS accept_referral(UUID, UUID, UUID, TEXT, INTERVAL, INTERVAL);
DROP FUNCTION IF EXISTS lapse_offers(UUID, INTERVAL);

CREATE OR REPLACE FUNCTION shortlist_referral(
  p_referral_id    UUID,
  p_poster_id      UUID,
  p_therapist_ids  UUID[],
  p_offer_window   INTERVAL DEFAULT INTERVAL '4 hours',
  p_test_delay     INTERVAL DEFAULT INTERVAL '0'
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = phase05_spike
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

CREATE OR REPLACE FUNCTION accept_referral(
  p_referral_id      UUID,
  p_interest_id      UUID,
  p_therapist_id     UUID,
  p_idempotency_key  TEXT,
  p_confirm_window   INTERVAL DEFAULT INTERVAL '24 hours',
  p_test_delay       INTERVAL DEFAULT INTERVAL '0'
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = phase05_spike
AS $$
DECLARE
  v_ref        home_case_referrals%ROWTYPE;
  v_hash       TEXT := md5(p_referral_id::text || ':' || p_interest_id::text || ':' || p_therapist_id::text);
  v_stored     idempotency_keys%ROWTYPE;
  v_accepted   UUID;
  v_confirm_by TIMESTAMPTZ;
  v_result     JSONB;
BEGIN
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

  IF v_accepted IS NULL THEN
    RAISE EXCEPTION 'went to someone else' USING ERRCODE = 'AHP03';
  END IF;

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

  v_result := jsonb_build_object(
    'referral_id', p_referral_id, 'interest_id', v_accepted,
    'accepted_by', p_therapist_id, 'confirm_deadline_at', v_confirm_by);

  INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response_json)
  VALUES (p_idempotency_key, p_therapist_id, 'accept_referral', v_hash, v_result);

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION lapse_offers(
  p_referral_id UUID,
  p_test_delay  INTERVAL DEFAULT INTERVAL '0'
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = phase05_spike
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

  RETURN jsonb_build_object('outcome', 'reopened', 'lapsed', v_lapsed);
END;
$$;
`;

export const TEARDOWN_SQL = `DROP SCHEMA IF EXISTS phase05_spike CASCADE;`;
