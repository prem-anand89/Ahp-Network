// Phase 12's hard gate (plan §7): "the race-correctness tests, the
// connection-pool load test, and the lapse-vs-accept and idempotency
// tests from Phase 6 all pass against staging under real concurrent
// load." referral-concurrency.test.ts (src/db/) proves the SQL functions
// are correct against a direct local Postgres connection — it does NOT
// prove anything about Hyperdrive's connection pooling under real
// concurrent HTTP load hitting a deployed Worker, which is the actual
// unproven variable this gate exists for.
//
// This reuses the exact real call sites the app itself uses
// (shortlistCandidatesTx/acceptOfferTx/lapse_offers via db.$client) —
// unlike the Phase 0.5 spike Worker (spike/worker/), which proved the
// general Hyperdrive-safety concept against a throwaway duplicate schema
// before Phase 6 existed. This runs the REAL functions, over the REAL
// staging Hyperdrive binding, against clearly-tagged, fully-cleanable
// fake data in the real tables.
//
// Every row this creates is tagged via LOAD_TEST_EMAIL_PREFIX so
// teardownLoadTestData can find and remove exactly this data and nothing
// else — never run this against a database with real users without
// verifying the prefix can't collide (it can't: no real signup flow
// produces an @loadtest.internal address).

import { shortlistCandidatesTx, acceptOfferTx } from "./referral-actions";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export const LOAD_TEST_EMAIL_PREFIX = "loadtest-";
const LOAD_TEST_EMAIL_DOMAIN = "loadtest.internal"; // never a real, deliverable domain

function loadTestEmail(): string {
  return `${LOAD_TEST_EMAIL_PREFIX}${crypto.randomUUID()}@${LOAD_TEST_EMAIL_DOMAIN}`;
}

interface SeededReferral {
  referralId: string;
  posterId: string;
  interests: { id: string; therapistUserId: string }[];
}

async function createLoadTestTherapist(db: Db): Promise<string> {
  const email = loadTestEmail();
  const [authUser] = await db.$client<{ id: string }[]>`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await db.$client`
    INSERT INTO users (id, email, account_type, role, specializations, verification_stage)
    VALUES (${authUser.id}, ${email}, 'therapist', 'physiotherapist', ARRAY['neuro_rehab']::specialization_type[], 'credentials_verified')`;
  return authUser.id;
}

async function seedLoadTestReferral(db: Db, therapistCount = 2): Promise<SeededReferral> {
  const posterId = await createLoadTestTherapist(db);
  const therapistIds: string[] = [];
  for (let i = 0; i < therapistCount; i++) therapistIds.push(await createLoadTestTherapist(db));

  const [referral] = await db.$client<{ id: string }[]>`
    INSERT INTO home_case_referrals (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required)
    VALUES (${posterId}, 'therapist', 'physiotherapist', 'neuro_rehab', true)
    RETURNING id`;

  const interests: { id: string; therapistUserId: string }[] = [];
  for (const therapistId of therapistIds) {
    const [interest] = await db.$client<{ id: string }[]>`
      INSERT INTO referral_interest (referral_id, therapist_user_id) VALUES (${referral.id}, ${therapistId}) RETURNING id`;
    interests.push({ id: interest.id, therapistUserId: therapistId });
  }

  return { referralId: referral.id, posterId, interests };
}

export interface LoadTestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

const settled = <T>(fns: (() => Promise<T>)[]) => Promise.allSettled(fns.map((f) => f()));

/** Mirrors referral-concurrency.test.ts's invariants 2 & 3, but over
 * Hyperdrive via the real acceptOfferTx call site instead of a direct
 * local Postgres connection. */
export async function runAcceptRaceTest(db: Db, iterations = 6): Promise<LoadTestCheck> {
  let bad = 0;
  let detail = "";
  for (let i = 0; i < iterations; i++) {
    const s = await seedLoadTestReferral(db, 2);
    await shortlistCandidatesTx(db, s.posterId, s.referralId, s.interests.map((it) => it.therapistUserId));

    const results = await settled(
      s.interests.map((it) => () => acceptOfferTx(db, it.therapistUserId, s.referralId, it.id, crypto.randomUUID())),
    );
    const won = results.filter((r) => r.status === "fulfilled").length;

    const [inv] = await db.$client<{ accepted: string; not_selected: string; dangling: string; ref_status: string }[]>`
      SELECT
        (SELECT count(*) FROM referral_interest WHERE referral_id = ${s.referralId} AND status = 'accepted') AS accepted,
        (SELECT count(*) FROM referral_interest WHERE referral_id = ${s.referralId} AND status = 'not_selected') AS not_selected,
        (SELECT count(*) FROM referral_interest WHERE referral_id = ${s.referralId} AND status = 'shortlisted') AS dangling,
        (SELECT status FROM home_case_referrals WHERE id = ${s.referralId}) AS ref_status`;

    if (won !== 1 || +inv.accepted !== 1 || +inv.not_selected !== 1 || +inv.dangling !== 0 || inv.ref_status !== "accepted") {
      bad++;
      detail = `iter ${i}: winners=${won} accepted=${inv.accepted} not_selected=${inv.not_selected} dangling=${inv.dangling} status=${inv.ref_status}`;
    }
  }
  return { name: `accept-race (${iterations}x, over Hyperdrive)`, ok: bad === 0, detail: bad ? detail : `${iterations}/${iterations} clean` };
}

/** Mirrors invariant 1 — no referral ever holds more than 2 shortlisted interests. */
export async function runShortlistCapTest(db: Db, iterations = 6): Promise<LoadTestCheck> {
  let bad = 0;
  let detail = "";
  for (let i = 0; i < iterations; i++) {
    const s = await seedLoadTestReferral(db, 4);
    const [a, b, c, d] = s.interests;

    const results = await settled([
      () => shortlistCandidatesTx(db, s.posterId, s.referralId, [a.therapistUserId, b.therapistUserId]),
      () => shortlistCandidatesTx(db, s.posterId, s.referralId, [c.therapistUserId, d.therapistUserId]),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    const [cnt] = await db.$client<{ n: string }[]>`
      SELECT count(*) AS n FROM referral_interest WHERE referral_id = ${s.referralId} AND status = 'shortlisted'`;

    if (+cnt.n > 2 || succeeded !== 1) {
      bad++;
      detail = `iter ${i}: succeeded=${succeeded} shortlisted=${cnt.n}`;
    }
  }
  return { name: `shortlist-cap (${iterations}x, over Hyperdrive)`, ok: bad === 0, detail: bad ? detail : `${iterations}/${iterations} clean` };
}

/** Mirrors invariant 5 — lapse_offers and accept_referral firing simultaneously never both succeed. */
export async function runLapseVsAcceptTest(db: Db, iterations = 6): Promise<LoadTestCheck> {
  let bad = 0;
  let detail = "";
  for (let i = 0; i < iterations; i++) {
    const s = await seedLoadTestReferral(db, 2);
    await shortlistCandidatesTx(db, s.posterId, s.referralId, s.interests.map((it) => it.therapistUserId));
    // Force the offer already expired, same as referral-concurrency.test.ts,
    // so the race is real rather than lapse_offers finding nothing due.
    await db.$client`UPDATE home_case_referrals SET offer_expires_at = now() - interval '1 second' WHERE id = ${s.referralId}`;
    const it = s.interests[0];

    const results = await settled<unknown>([
      () => acceptOfferTx(db, it.therapistUserId, s.referralId, it.id, crypto.randomUUID()),
      () => db.$client<{ result: unknown }[]>`SELECT lapse_offers(${s.referralId}) AS result`,
    ]);

    const [inv] = await db.$client<{ accepted: string; missed: string; ref_status: string }[]>`
      SELECT
        (SELECT count(*) FROM referral_interest WHERE referral_id = ${s.referralId} AND status = 'accepted') AS accepted,
        (SELECT count(*) FROM referral_interest WHERE referral_id = ${s.referralId} AND status = 'missed') AS missed,
        (SELECT status FROM home_case_referrals WHERE id = ${s.referralId}) AS ref_status`;

    // lapse_offers() puts a fully-lapsed referral back to 'open' for
    // rerouting (drizzle/0016), not 'expired' — 'expired' is a distinct,
    // separately-driven terminal state.
    const acceptOk = results[0].status === "fulfilled";
    const legal = acceptOk
      ? +inv.accepted === 1 && inv.ref_status === "accepted" && +inv.missed === 0
      : +inv.accepted === 0 && inv.ref_status === "open" && +inv.missed === 2;

    if (!legal) {
      bad++;
      detail = `iter ${i}: acceptOk=${acceptOk} accepted=${inv.accepted} missed=${inv.missed} status=${inv.ref_status}`;
    }
  }
  return { name: `lapse-vs-accept (${iterations}x, over Hyperdrive)`, ok: bad === 0, detail: bad ? detail : `${iterations}/${iterations} clean` };
}

/** Mirrors invariant 6 — a repeated accept with the same idempotency key produces one accept, not two. */
export async function runIdempotencyTest(db: Db, iterations = 6): Promise<LoadTestCheck> {
  let bad = 0;
  let detail = "";
  for (let i = 0; i < iterations; i++) {
    const s = await seedLoadTestReferral(db, 2);
    await shortlistCandidatesTx(db, s.posterId, s.referralId, s.interests.map((it) => it.therapistUserId));
    const it = s.interests[0];
    const key = crypto.randomUUID();

    const results = await settled([
      () => acceptOfferTx(db, it.therapistUserId, s.referralId, it.id, key),
      () => acceptOfferTx(db, it.therapistUserId, s.referralId, it.id, key),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    const [cnt] = await db.$client<{ accepted: string; keys: string }[]>`
      SELECT
        (SELECT count(*) FROM referral_interest WHERE referral_id = ${s.referralId} AND status = 'accepted') AS accepted,
        (SELECT count(*) FROM idempotency_keys WHERE key = ${key}) AS keys`;

    if (+cnt.accepted !== 1 || +cnt.keys !== 1 || succeeded === 0) {
      bad++;
      detail = `iter ${i}: succeeded=${succeeded} accepted=${cnt.accepted} keys=${cnt.keys}`;
    }
  }
  return { name: `idempotent double-tap (${iterations}x, over Hyperdrive)`, ok: bad === 0, detail: bad ? detail : `${iterations}/${iterations} clean` };
}

/** THE test this whole module exists for — aggregate concurrency across
 * many different referrals at once, over Hyperdrive's real connection
 * pool, from within the real deployed Worker. The one thing no local
 * test (this module's siblings included, when run via `wrangler dev`'s
 * local proxy) can fully substitute for. */
export async function runPoolLoadTest(db: Db, n = 10): Promise<LoadTestCheck & { elapsedMs: number; perFlowMs: number }> {
  const seeds: SeededReferral[] = [];
  for (let i = 0; i < n; i++) seeds.push(await seedLoadTestReferral(db, 2));

  const started = Date.now();
  const results = await settled(
    seeds.map((s) => async () => {
      await shortlistCandidatesTx(db, s.posterId, s.referralId, s.interests.map((it) => it.therapistUserId));
      const it = s.interests[Math.floor(Math.random() * s.interests.length)];
      return acceptOfferTx(db, it.therapistUserId, s.referralId, it.id, crypto.randomUUID());
    }),
  );
  const elapsedMs = Date.now() - started;

  const rejected = results.filter((r) => r.status === "rejected");
  const [dup] = await db.$client<{ n: string }[]>`
    SELECT count(*) AS n FROM (
      SELECT referral_id FROM referral_interest WHERE status = 'accepted'
      GROUP BY referral_id HAVING count(*) > 1
    ) x`;

  const ok = rejected.length === 0 && +dup.n === 0;
  return {
    name: `pool-load (${n} concurrent referrals, over Hyperdrive — the real §7 gate)`,
    ok,
    detail: ok ? `${n}/${n} flows clean, no pool exhaustion, no dup accepts` : `${rejected.length} rejected, ${dup.n} referrals with duplicate accepts`,
    elapsedMs,
    perFlowMs: elapsedMs / n,
  };
}

/** Deletes every row this module could have created, and nothing else —
 * scoped entirely by the @loadtest.internal email domain, which no real
 * signup flow can ever produce. Safe to call repeatedly. */
export async function teardownLoadTestData(db: Db): Promise<{ usersDeleted: number }> {
  const domain = `%@${LOAD_TEST_EMAIL_DOMAIN}`;

  await db.$client`
    DELETE FROM notification_outbox WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${domain})`;
  await db.$client`
    DELETE FROM idempotency_keys WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${domain})`;
  await db.$client`
    DELETE FROM referral_events WHERE referral_id IN (
      SELECT id FROM home_case_referrals WHERE posted_by_user_id IN (SELECT id FROM users WHERE email LIKE ${domain}))`;
  await db.$client`
    DELETE FROM referral_interest WHERE referral_id IN (
      SELECT id FROM home_case_referrals WHERE posted_by_user_id IN (SELECT id FROM users WHERE email LIKE ${domain}))
    OR therapist_user_id IN (SELECT id FROM users WHERE email LIKE ${domain})`;
  await db.$client`
    DELETE FROM home_case_referrals WHERE posted_by_user_id IN (SELECT id FROM users WHERE email LIKE ${domain})`;
  const deletedUsers = await db.$client<{ id: string }[]>`
    DELETE FROM users WHERE email LIKE ${domain} RETURNING id`;
  await db.$client`DELETE FROM auth.users WHERE email LIKE ${domain}`;

  return { usersDeleted: deletedUsers.length };
}
