-- Phase 0.5 spike schema — minimal, only the columns the three transactions touch.
-- Mirrors plan §8D. THROWAWAY: the spike is deleted after the results are recorded;
-- what survives is the function bodies in 002 and the invariant tests.

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

-- Plan §8D: the two partial unique indexes. These are a backstop, not the primary
-- mechanism — the referral row lock is what actually serialises the race.
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
-- v19 (A6): dedupe is what makes a retried transaction unable to double-send.
CREATE UNIQUE INDEX notification_outbox_dedupe
  ON notification_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_outbox_claimable
  ON notification_outbox (next_attempt_at) WHERE status = 'pending';

-- v19 (A5): idempotency for the accept endpoint.
CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
