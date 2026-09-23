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

async function createReferral(posterId: string, urgency: "routine" | "urgent" = "routine"): Promise<string> {
  const [ref] = await client`
    INSERT INTO home_case_referrals
      (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, patient_consent_recorded_at, urgency)
    VALUES (${posterId}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', true, now(), ${urgency})
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

async function seedShortlistRace(n: number, urgency: "routine" | "urgent" = "routine") {
  const poster = await createUser(`poster-${crypto.randomUUID()}@test.local`);
  const referralId = await createReferral(poster, urgency);
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

// Round 2 (0045) — the offer window moved from 30min/1h to 2h urgent /
// 12h routine, and the routine clock only runs 07:00–22:00 IST
// (add_waking_time). Superseded 0036's regression tests; the "derived from
// urgency, called exactly as the app calls it (3 args)" property they
// guarded is still what these check.
describe("offer window — 2h urgent, 12h of waking time routine (0045)", () => {
  it("an urgent referral's offer window is 2 hours of wall clock when no p_offer_window is passed", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2, "urgent");
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;

    const [{ minutes }] = await client`
      SELECT extract(epoch FROM offer_expires_at - now()) / 60 AS minutes
        FROM home_case_referrals WHERE id = ${referralId}`;
    expect(Number(minutes)).toBeGreaterThan(115);
    expect(Number(minutes)).toBeLessThan(125);
  });

  it("a routine referral's offer window is exactly 12 waking hours from the moment it was shortlisted", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2, "routine");
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;

    // shortlisted_at and offer_expires_at are both written from the same
    // transaction's now(), so this is an exact equality, not a tolerance —
    // and it holds whatever time of day the suite happens to run.
    const [{ matches }] = await client`
      SELECT bool_and(r.offer_expires_at = add_waking_time(ri.shortlisted_at, '12 hours')) AS matches
        FROM home_case_referrals r
        JOIN referral_interest ri ON ri.referral_id = r.id AND ri.status = 'shortlisted'
       WHERE r.id = ${referralId}`;
    expect(matches).toBe(true);
  });

  it("an explicit p_offer_window still overrides the derived window (tests only)", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2, "urgent");
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)}, '3 hours')`;

    const [{ minutes }] = await client`
      SELECT extract(epoch FROM offer_expires_at - now()) / 60 AS minutes
        FROM home_case_referrals WHERE id = ${referralId}`;
    expect(Number(minutes)).toBeGreaterThan(175);
    expect(Number(minutes)).toBeLessThan(185);
  });
});

describe("add_waking_time — the routine clock pauses 22:00–07:00 IST", () => {
  const cases: [string, string, string, string][] = [
    ["inside one waking day", "2026-09-24 10:00+05:30", "12 hours", "2026-09-24 22:00:00"],
    ["crosses one night", "2026-09-24 11:00+05:30", "12 hours", "2026-09-25 08:00:00"],
    ["one minute before the pause", "2026-09-24 21:59+05:30", "12 hours", "2026-09-25 18:59:00"],
    ["started during the pause", "2026-09-24 23:30+05:30", "12 hours", "2026-09-25 19:00:00"],
    ["started in the early-morning pause", "2026-09-24 03:00+05:30", "12 hours", "2026-09-24 19:00:00"],
    ["started exactly at 22:00", "2026-09-24 22:00+05:30", "1 hour", "2026-09-25 08:00:00"],
    ["an evening extension", "2026-09-24 20:00+05:30", "6 hours", "2026-09-25 11:00:00"],
  ];

  for (const [label, start, duration, expectedIst] of cases) {
    it(label, async () => {
      const [{ result }] = await client`
        SELECT to_char(add_waking_time(${start}::timestamptz, ${duration}::interval) AT TIME ZONE 'Asia/Kolkata',
                       'YYYY-MM-DD HH24:MI:SS') AS result`;
      expect(result).toBe(expectedIst);
    });
  }

  it("urgent never pauses — offer_deadline is plain wall clock at 23:00", async () => {
    const [{ result }] = await client`
      SELECT to_char(offer_deadline('2026-09-24 23:00+05:30'::timestamptz, 'urgent') AT TIME ZONE 'Asia/Kolkata',
                     'YYYY-MM-DD HH24:MI:SS') AS result`;
    expect(result).toBe("2026-09-25 01:00:00");
  });
});

describe("Re-Offer — a missed therapist can be shortlisted again (0045)", () => {
  it("after a lapse, the poster can re-offer a missed therapist, and they are actually notified", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId]}, '0 seconds')`;
    await client`SELECT lapse_offers(${referralId})`;

    const [{ status: missedStatus }] = await client`SELECT status FROM referral_interest WHERE id = ${therapists[0].interestId}`;
    expect(missedStatus).toBe("missed");

    const [row] = await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId]}) AS result`;
    expect(row.result.re_offered).toBe(1);

    const [{ status }] = await client`SELECT status FROM referral_interest WHERE id = ${therapists[0].interestId}`;
    expect(status).toBe("shortlisted");

    // The regression this guards: the first offer's dedupe key would have
    // swallowed the second notification.
    const [{ count }] = await client`
      SELECT count(*)::int FROM notification_outbox
       WHERE user_id = ${therapists[0].userId} AND template = 'referral_offered'
         AND payload->>'referral_id' = ${referralId}`;
    expect(count).toBe(2);
  });

  it("a therapist holding both a missed and a pending row is shortlisted once, from the pending row", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(1);
    await client`UPDATE referral_interest SET status = 'missed' WHERE id = ${therapists[0].interestId}`;
    const pendingId = await createInterest(referralId, therapists[0].userId);

    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId]})`;

    const rows = await client`SELECT id, status FROM referral_interest WHERE referral_id = ${referralId} ORDER BY created_at`;
    expect(rows.find((r) => r.id === pendingId)?.status).toBe("shortlisted");
    expect(rows.find((r) => r.id === therapists[0].interestId)?.status).toBe("missed");
  });

  it("a declined therapist is never re-offerable — that was an explicit no", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(1);
    await client`UPDATE referral_interest SET status = 'declined' WHERE id = ${therapists[0].interestId}`;

    await expect(
      client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId]})`,
    ).rejects.toMatchObject({ code: "AHP02" });
  });

  it("adding a second therapist to a live round never shortens the first one's clock", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2, "urgent");
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId]}, '5 hours')`;
    const [{ offer_expires_at: before }] = await client`SELECT offer_expires_at FROM home_case_referrals WHERE id = ${referralId}`;

    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[1].userId]})`;
    const [{ offer_expires_at: after }] = await client`SELECT offer_expires_at FROM home_case_referrals WHERE id = ${referralId}`;

    expect(new Date(after).getTime()).toBe(new Date(before).getTime());
  });
});

describe("extend_offer — once per round, only while live (0045)", () => {
  it("extends an urgent round by exactly 1 hour, and notifies both shortlisted therapists", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2, "urgent");
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;
    const [{ offer_expires_at: before }] = await client`SELECT offer_expires_at FROM home_case_referrals WHERE id = ${referralId}`;

    await client`SELECT extend_offer(${referralId}, ${poster})`;

    const [{ offer_expires_at: after, extended_once }] = await client`
      SELECT offer_expires_at, extended_once FROM home_case_referrals WHERE id = ${referralId}`;
    expect(new Date(after).getTime() - new Date(before).getTime()).toBe(60 * 60 * 1000);
    expect(extended_once).toBe(true);

    const [{ count }] = await client`
      SELECT count(*)::int FROM notification_outbox
       WHERE template = 'referral_offer_extended' AND payload->>'referral_id' = ${referralId}`;
    expect(count).toBe(2);
  });

  it("a second extension in the same round is refused (AHP07)", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(1);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId]})`;
    await client`SELECT extend_offer(${referralId}, ${poster})`;

    await expect(client`SELECT extend_offer(${referralId}, ${poster})`).rejects.toMatchObject({ code: "AHP07" });
  });

  it("refuses an offer that has already expired (AHP05) — lapse_offers resolves it, extend never resurrects it", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(1);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId]}, '0 seconds')`;

    await expect(client`SELECT extend_offer(${referralId}, ${poster})`).rejects.toMatchObject({ code: "AHP05" });
  });

  it("only the poster can extend (AHP04)", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(1);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId]})`;

    await expect(
      client`SELECT extend_offer(${referralId}, ${therapists[0].userId})`,
    ).rejects.toMatchObject({ code: "AHP04" });
  });

  it("a fresh round after a lapse can be extended again", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[0].userId]}, '1 hour')`;
    await client`SELECT extend_offer(${referralId}, ${poster})`;
    await client`UPDATE home_case_referrals SET offer_expires_at = now() - interval '1 second' WHERE id = ${referralId}`;
    await client`SELECT lapse_offers(${referralId})`;

    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${[therapists[1].userId]})`;
    await expect(client`SELECT extend_offer(${referralId}, ${poster})`).resolves.toBeDefined();
  });

  it("extend vs accept, concurrently — one coherent outcome, never half-applied", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;

    await Promise.allSettled([
      client`SELECT extend_offer(${referralId}, ${poster}, ${DELAY})`,
      client`SELECT accept_referral(${referralId}, ${therapists[0].interestId}, ${therapists[0].userId}, ${crypto.randomUUID()}, '24 hours', ${DELAY})`,
    ]);

    const [ref] = await client`SELECT status, extended_once FROM home_case_referrals WHERE id = ${referralId}`;
    expect(ref.status).toBe("accepted");

    const [{ count: extendEvents }] = await client`
      SELECT count(*)::int FROM referral_events WHERE referral_id = ${referralId} AND event_type = 'offer_extended'`;
    expect(extendEvents).toBe(ref.extended_once ? 1 : 0);

    const [{ count: dangling }] = await client`
      SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referralId} AND status = 'shortlisted'`;
    expect(dangling).toBe(0);
  });

  it("extend vs lapse, concurrently — an extended round is never also lapsed", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    // Expires just after both calls start; whichever takes the lock first
    // decides, but the two outcomes must never both land.
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)}, '0.2 seconds')`;

    const [extendResult] = await Promise.allSettled([
      client`SELECT extend_offer(${referralId}, ${poster}, ${DELAY})`,
      client`SELECT lapse_offers(${referralId}, ${DELAY})`,
    ]);

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    const [{ count: missed }] = await client`
      SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referralId} AND status = 'missed'`;

    if (extendResult.status === "fulfilled") {
      expect(status).toBe("shortlisted");
      expect(missed).toBe(0);
    } else {
      expect(["open", "shortlisted"]).toContain(status);
    }
    if (status === "open") {
      expect(extendResult.status).toBe("rejected");
    }
  });
});

describe("decline_offer — locked, status-checked, reopens when nobody is left (0045)", () => {
  it("declining one of two leaves the other's offer standing", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;

    await client`SELECT decline_offer(${referralId}, ${therapists[0].interestId}, ${therapists[0].userId})`;

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(status).toBe("shortlisted");
    const [{ status: other }] = await client`SELECT status FROM referral_interest WHERE id = ${therapists[1].interestId}`;
    expect(other).toBe("shortlisted");
  });

  it("when both decline, the referral reopens immediately and the poster is told — no 12-hour wait", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;

    for (const t of therapists) {
      await client`SELECT decline_offer(${referralId}, ${t.interestId}, ${t.userId})`;
    }

    const [ref] = await client`SELECT status, offer_expires_at, reroute_count FROM home_case_referrals WHERE id = ${referralId}`;
    expect(ref.status).toBe("open");
    expect(ref.offer_expires_at).toBeNull();
    expect(ref.reroute_count).toBe(1);

    const [{ count }] = await client`
      SELECT count(*)::int FROM notification_outbox
       WHERE user_id = ${poster} AND template = 'referral_declined_choose_again'`;
    expect(count).toBe(1);
  });

  it("an accepted offer can never be overwritten to declined (the old application UPDATE could)", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;
    await client`SELECT accept_referral(${referralId}, ${therapists[0].interestId}, ${therapists[0].userId}, ${crypto.randomUUID()})`;

    await expect(
      client`SELECT decline_offer(${referralId}, ${therapists[0].interestId}, ${therapists[0].userId})`,
    ).rejects.toMatchObject({ code: "AHP05" });

    const [{ status }] = await client`SELECT status FROM referral_interest WHERE id = ${therapists[0].interestId}`;
    expect(status).toBe("accepted");
  });

  it("decline vs accept, concurrently, from the two shortlisted therapists — exactly one accept, never reopened", async () => {
    const { poster, referralId, therapists } = await seedShortlistRace(2);
    await client`SELECT shortlist_referral(${referralId}, ${poster}, ${therapists.map((t) => t.userId)})`;

    await Promise.allSettled([
      client`SELECT accept_referral(${referralId}, ${therapists[0].interestId}, ${therapists[0].userId}, ${crypto.randomUUID()}, '24 hours', ${DELAY})`,
      client`SELECT decline_offer(${referralId}, ${therapists[1].interestId}, ${therapists[1].userId}, ${DELAY})`,
    ]);

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(status).toBe("accepted");
    const [{ status: loser }] = await client`SELECT status FROM referral_interest WHERE id = ${therapists[1].interestId}`;
    expect(["not_selected", "declined"]).toContain(loser);
  });
});

describe("search_path pin — every referral function, so 0036's silent regression can't recur", () => {
  it("each referral-engine function carries SET search_path = public, pg_temp", async () => {
    const rows = await client`
      SELECT proname, proconfig FROM pg_proc
       WHERE proname IN ('shortlist_referral','accept_referral','lapse_offers','extend_offer',
                         'decline_offer','add_waking_time','offer_deadline')`;
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.proconfig, row.proname).toContain("search_path=public, pg_temp");
    }
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
