// §8D's launch gate, per BUILD_SEQUENCE.md Phase 6 — the three referral
// state transitions proven once already in the Phase 0.5 spike, proven
// again here against the real schema as the permanent regression suite.
// Runs against a real local Postgres, never mocks (BUILD_SEQUENCE.md
// Phase 0's test-stack convention) — these are database concurrency
// invariants; a mock cannot fail the way the database can.
//
// Every race below uses p_test_delay to hold the critical window open —
// without it, two `pool.query` calls fired from Node complete sequentially
// far more often than they overlap (each function runs in ~2ms), and 300
// iterations against a deliberately broken function produced zero
// violations in the Phase 0.5 spike. The negative-control test at the
// bottom proves this suite can actually fail — a concurrency test nobody
// has watched fail is not evidence (spike/README.md).

import { afterAll, afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";

const DELAY = "0.25 seconds"; // forces concurrent callers into the lock window together

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 20 });

const createdUserIds: string[] = [];
const createdReferralIds: string[] = [];

afterEach(async () => {
  let referralId: string | undefined;
  while ((referralId = createdReferralIds.pop()) !== undefined) {
    await client`DELETE FROM notification_outbox WHERE payload->>'referral_id' = ${referralId}`;
    await client`DELETE FROM idempotency_keys WHERE response_json->>'referral_id' = ${referralId}`;
    await client`DELETE FROM referral_events WHERE referral_id = ${referralId}`;
    await client`DELETE FROM referral_interest WHERE referral_id = ${referralId}`;
    await client`DELETE FROM home_case_referrals WHERE id = ${referralId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(email: string): Promise<string> {
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function createReferral(posterId: string): Promise<string> {
  const [ref] = await client`
    INSERT INTO home_case_referrals
      (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required)
    VALUES (${posterId}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', true)
    RETURNING id`;
  createdReferralIds.push(ref.id);
  return ref.id;
}

async function createInterest(referralId: string, therapistId: string): Promise<string> {
  const [interest] = await client`
    INSERT INTO referral_interest (referral_id, therapist_user_id)
    VALUES (${referralId}, ${therapistId}) RETURNING id`;
  return interest.id;
}

async function seedShortlistRace(n: number) {
  const poster = await createUser(`poster-${crypto.randomUUID()}@test.local`);
  const referralId = await createReferral(poster);
  const therapists: { userId: string; interestId: string }[] = [];
  for (let i = 0; i < n; i++) {
    const userId = await createUser(`therapist-${crypto.randomUUID()}@test.local`);
    const interestId = await createInterest(referralId, userId);
    therapists.push({ userId, interestId });
  }
  return { poster, referralId, therapists };
}

describe("shortlist_referral / accept_referral / lapse_offers — §8D concurrency invariants", () => {
  it("invariant 1: no referral ever holds more than 2 shortlisted interests, under concurrent shortlist calls", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(4);

    await Promise.allSettled([
      client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId, therapists[1].userId]}, '4 hours', ${DELAY})`,
      client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[2].userId, therapists[3].userId]}, '4 hours', ${DELAY})`,
    ]);

    const [{ count }] = await client`
      SELECT count(*)::int FROM referral_interest
      WHERE referral_id = ${referralId} AND status = 'shortlisted'`;
    expect(count).toBeLessThanOrEqual(2);
  });

  it("invariants 2 & 3: exactly one accept wins, the sibling always resolves to not_selected, never dangling", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;

    await Promise.allSettled(
      therapists.map(
        (t) =>
          client`SELECT accept_referral(${referralId}, ${t.interestId}, ${t.userId}, ${crypto.randomUUID()}, '24 hours', ${DELAY})`,
      ),
    );

    const [{ count: acceptedCount }] = await client`
      SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referralId} AND status = 'accepted'`;
    expect(acceptedCount).toBe(1);

    const [{ count: danglingCount }] = await client`
      SELECT count(*)::int FROM referral_interest
      WHERE referral_id = ${referralId} AND status = 'shortlisted'`;
    expect(danglingCount).toBe(0);

    const [{ count: notSelectedCount }] = await client`
      SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referralId} AND status = 'not_selected'`;
    expect(notSelectedCount).toBe(1);
  });

  it("invariant 4: dozens of concurrent shortlist+accept flows across many different referrals — no cross-transaction lock bleed", async () => {
    const flows = await Promise.all(Array.from({ length: 20 }, () => seedShortlistRace(2)));

    await Promise.all(
      flows.map(async ({ poster, referralId, therapists }) => {
        await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;
        await client`SELECT accept_referral(${referralId}, ${therapists[0].interestId}, ${therapists[0].userId}, ${crypto.randomUUID()})`;
      }),
    );

    const results = await Promise.all(
      flows.map(
        ({ referralId }) =>
          client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`,
      ),
    );
    for (const [row] of results) {
      expect(row.status).toBe("accepted");
    }
  });

  it("invariant 5: lapse_offers and accept_referral firing simultaneously never both succeed", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)}, '0 seconds')`;
    // offer_expires_at is already in the past (window = 0s) — lapse_offers is now due.

    const [acceptResult, lapseResult] = await Promise.allSettled([
      client`SELECT accept_referral(${referralId}, ${therapists[0].interestId}, ${therapists[0].userId}, ${crypto.randomUUID()}, '24 hours', ${DELAY})`,
      client`SELECT lapse_offers(${referralId}, ${DELAY})`,
    ]);

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    // Whichever won, the referral must land in a coherent state — never
    // 'accepted' with a 'missed' winner, never both transactions' effects
    // half-applied.
    expect(["accepted", "open"]).toContain(status);
    if (status === "accepted") {
      const [{ count }] = await client`
        SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referralId} AND status = 'missed'`;
      expect(count).toBe(0);
    }
    expect(acceptResult.status === "fulfilled" || lapseResult.status === "fulfilled").toBe(true);
  });

  it("invariant 6: a repeated accept carrying the same idempotency key produces one accept, not two", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;
    const key = crypto.randomUUID();

    await Promise.allSettled([
      client`SELECT accept_referral(${referralId}, ${therapists[0].interestId}, ${therapists[0].userId}, ${key}, '24 hours', ${DELAY})`,
      client`SELECT accept_referral(${referralId}, ${therapists[0].interestId}, ${therapists[0].userId}, ${key}, '24 hours', ${DELAY})`,
    ]);

    const [{ count: acceptedCount }] = await client`
      SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referralId} AND status = 'accepted'`;
    expect(acceptedCount).toBe(1);

    const [{ count: keyCount }] = await client`
      SELECT count(*)::int FROM idempotency_keys WHERE key = ${key}`;
    expect(keyCount).toBe(1);
  });
});

describe("negative control — proves this suite can actually fail", () => {
  // Same shape as shortlist_referral but with the row lock removed,
  // defined under a different name so the real function is never touched.
  // Mirrors spike/src/negative-control.mjs's discovery: without the lock,
  // 300 iterations against Node's fast, sequential-in-practice queries
  // produced zero violations — proving nothing. This test proves the
  // opposite: with the delay seam forcing real overlap, the missing lock
  // is caught reliably.
  it("without the FOR UPDATE lock, concurrent shortlist calls DO exceed the 2-slot cap", async () => {
    await client`
      CREATE OR REPLACE FUNCTION shortlist_referral_broken_test_only(
        p_referral_id UUID, p_poster_id UUID, p_therapist_ids UUID[], p_test_delay INTERVAL
      ) RETURNS JSONB LANGUAGE plpgsql AS $$
      DECLARE
        v_existing INT;
        v_chosen INT := coalesce(array_length(p_therapist_ids, 1), 0);
      BEGIN
        -- Deliberately no "FOR UPDATE" here — the bug under test.
        PERFORM 1 FROM home_case_referrals WHERE id = p_referral_id AND deleted_at IS NULL;
        SELECT count(*) INTO v_existing FROM referral_interest
         WHERE referral_id = p_referral_id AND status = 'shortlisted' AND deleted_at IS NULL;
        IF p_test_delay > INTERVAL '0' THEN PERFORM pg_sleep(extract(epoch FROM p_test_delay)); END IF;
        IF v_existing + v_chosen > 2 THEN
          RAISE EXCEPTION 'shortlist cap exceeded' USING ERRCODE = 'AHP01';
        END IF;
        UPDATE referral_interest SET status = 'shortlisted', shortlisted_at = now()
         WHERE referral_id = p_referral_id AND therapist_user_id = ANY(p_therapist_ids) AND status = 'pending';
        RETURN jsonb_build_object('ok', true);
      END; $$`;

    try {
      const { poster, referralId, therapists } = await seedShortlistRace(4);

      await Promise.allSettled([
        client`SELECT shortlist_referral_broken_test_only(${referralId}, ${poster}, ${[therapists[0].userId, therapists[1].userId]}, ${DELAY})`,
        client`SELECT shortlist_referral_broken_test_only(${referralId}, ${poster}, ${[therapists[2].userId, therapists[3].userId]}, ${DELAY})`,
      ]);

      const [{ count }] = await client`
        SELECT count(*)::int FROM referral_interest
        WHERE referral_id = ${referralId} AND status = 'shortlisted'`;
      expect(count).toBe(4); // all 4 got in — the cap was never enforced
    } finally {
      await client`DROP FUNCTION IF EXISTS shortlist_referral_broken_test_only(UUID, UUID, UUID[], INTERVAL)`;
    }
  });
});
