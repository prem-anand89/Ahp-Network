// Phase 0.5 — referral engine invariant tests (plan §8D, BUILD_SEQUENCE Phase 0.5).
//
// These are the tests that become the Phase 12 launch gate. They must run against
// a REAL Postgres — the invariants under test are database behaviour, and a mock
// cannot fail the way the database can.
//
// Each test drives genuinely concurrent calls through a connection pool, so the
// races are real races, not simulated ones.

import pg from 'pg';

const CONN = process.env.SPIKE_DATABASE_URL
  ?? 'postgres://postgres:spike@127.0.0.1:5432/ahp_spike';

const pool = new pg.Pool({ connectionString: CONN, max: 30 });
const uuid = () => crypto.randomUUID();

// Forces the critical window open so races are deterministic. Without it these
// tests pass even against functions with the row lock removed — verified via
// negctl.mjs, and the reason that negative control is part of the suite.
const DELAY = process.env.SPIKE_RACE_DELAY ?? '0.25 seconds';

let passes = 0, failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passes++; console.log(`    ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`    ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function seed({ interested = 2, offerWindow = '4 hours' } = {}) {
  const poster = uuid();
  await pool.query('INSERT INTO users (id, name) VALUES ($1, $2)', [poster, 'poster']);
  const { rows: [ref] } = await pool.query(
    'INSERT INTO home_case_referrals (posted_by_user_id) VALUES ($1) RETURNING id', [poster]);
  const therapists = [];
  for (let i = 0; i < interested; i++) {
    const t = uuid();
    await pool.query('INSERT INTO users (id, name) VALUES ($1, $2)', [t, `therapist-${i}`]);
    const { rows: [ri] } = await pool.query(
      'INSERT INTO referral_interest (referral_id, therapist_user_id) VALUES ($1,$2) RETURNING id',
      [ref.id, t]);
    therapists.push({ userId: t, interestId: ri.id });
  }
  return { poster, referralId: ref.id, therapists, offerWindow };
}

// Fire N calls as concurrently as the pool allows, and report settled outcomes.
const race = (fns) => Promise.allSettled(fns.map(f => f()));

const call = (sql, params) => pool.query(sql, params);

// ---------------------------------------------------------------------------
// Test 1 — race correctness: concurrent accepts on the SAME referral.
// The shortlist is capped at 2, so this is inherently a 2-way race (§8D).
// ---------------------------------------------------------------------------
async function testAcceptRace(iterations = 25) {
  console.log(`\n  Test 1 — accept vs accept, same referral (${iterations} iterations)`);
  let bad = 0, detail = '';
  for (let i = 0; i < iterations; i++) {
    const s = await seed();
    await call('SELECT shortlist_referral($1,$2,$3)',
      [s.referralId, s.poster, s.therapists.map(t => t.userId)]);

    const results = await race(s.therapists.map(t => () =>
      call('SELECT accept_referral($1,$2,$3,$4,$5::interval,$6::interval)',
        [s.referralId, t.interestId, t.userId, uuid(), '24 hours', DELAY])));

    const won = results.filter(r => r.status === 'fulfilled').length;
    const { rows: [inv] } = await pool.query(`
      SELECT
        (SELECT count(*) FROM referral_interest WHERE referral_id=$1 AND status='accepted')     AS accepted,
        (SELECT count(*) FROM referral_interest WHERE referral_id=$1 AND status='not_selected') AS not_selected,
        (SELECT count(*) FROM referral_interest WHERE referral_id=$1 AND status='shortlisted')  AS dangling,
        (SELECT status   FROM home_case_referrals WHERE id=$1)                                  AS ref_status
    `, [s.referralId]);

    if (won !== 1 || +inv.accepted !== 1 || +inv.not_selected !== 1 || +inv.dangling !== 0
        || inv.ref_status !== 'accepted') {
      bad++;
      detail = `iter ${i}: winners=${won} accepted=${inv.accepted} not_selected=${inv.not_selected} dangling=${inv.dangling} status=${inv.ref_status}`;
    }
  }
  check('exactly one therapist accepts, every time', bad === 0, detail);
  check('the losing sibling always resolves to not_selected, never dangling', bad === 0, detail);
}

// ---------------------------------------------------------------------------
// Test 2 — the shortlist cap. Concurrent shortlist attempts must never exceed 2.
// ---------------------------------------------------------------------------
async function testShortlistCap(iterations = 25) {
  console.log(`\n  Test 2 — shortlist cap under concurrency (${iterations} iterations)`);
  let bad = 0, detail = '';
  for (let i = 0; i < iterations; i++) {
    const s = await seed({ interested: 4 });
    // Two concurrent shortlist calls, each asking for 2 different therapists.
    // Serialised by the row lock, the second must be rejected by the cap.
    const results = await race([
      () => call('SELECT shortlist_referral($1,$2,$3,$4::interval,$5::interval)',
        [s.referralId, s.poster, [s.therapists[0].userId, s.therapists[1].userId], '4 hours', DELAY]),
      () => call('SELECT shortlist_referral($1,$2,$3,$4::interval,$5::interval)',
        [s.referralId, s.poster, [s.therapists[2].userId, s.therapists[3].userId], '4 hours', DELAY]),
    ]);
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const { rows: [c] } = await pool.query(
      `SELECT count(*) AS n FROM referral_interest WHERE referral_id=$1 AND status='shortlisted'`,
      [s.referralId]);
    if (+c.n > 2 || ok !== 1) { bad++; detail = `iter ${i}: succeeded=${ok} shortlisted=${c.n}`; }
  }
  check('no referral ever holds more than 2 shortlisted interests', bad === 0, detail);
  check('a partial shortlist is never left behind (all-or-nothing)', bad === 0, detail);
}

// ---------------------------------------------------------------------------
// Test 3 — v19 (A4): lapse vs accept on the same referral, same instant.
// v18 specified no transaction for this at all.
// ---------------------------------------------------------------------------
async function testLapseVsAccept(iterations = 25) {
  console.log(`\n  Test 3 — lapse vs accept, same referral (${iterations} iterations)`);
  let bad = 0, detail = '';
  for (let i = 0; i < iterations; i++) {
    const s = await seed();
    // Zero-length offer window: the offer is already expired, so the scheduler
    // and the therapist are genuinely contending for the same referral.
    await call('SELECT shortlist_referral($1,$2,$3,$4::interval)',
      [s.referralId, s.poster, s.therapists.map(t => t.userId), '0 seconds']);

    const t = s.therapists[0];
    const results = await race([
      () => call('SELECT accept_referral($1,$2,$3,$4,$5::interval,$6::interval)',
        [s.referralId, t.interestId, t.userId, uuid(), '24 hours', DELAY]),
      () => call('SELECT lapse_offers($1,$2::interval)', [s.referralId, DELAY]),
    ]);

    const { rows: [inv] } = await pool.query(`
      SELECT
        (SELECT count(*) FROM referral_interest WHERE referral_id=$1 AND status='accepted') AS accepted,
        (SELECT count(*) FROM referral_interest WHERE referral_id=$1 AND status='missed')   AS missed,
        (SELECT status   FROM home_case_referrals WHERE id=$1)                              AS ref_status
    `, [s.referralId]);

    const acceptOk = results[0].status === 'fulfilled';
    // The two legal outcomes, and nothing else:
    //   accept won  → referral accepted, one accepted interest, winner not missed
    //   lapse won   → referral reopened, zero accepted, offers missed
    const legal = acceptOk
      ? (+inv.accepted === 1 && inv.ref_status === 'accepted' && +inv.missed === 0)
      : (+inv.accepted === 0 && inv.ref_status === 'open' && +inv.missed === 2);
    if (!legal) {
      bad++;
      detail = `iter ${i}: acceptOk=${acceptOk} accepted=${inv.accepted} missed=${inv.missed} status=${inv.ref_status}`;
    }
  }
  check('an accepted referral is never also marked missed', bad === 0, detail);
  check('lapse no-ops cleanly when the accept won', bad === 0, detail);
}

// ---------------------------------------------------------------------------
// Test 4 — v19 (A5): idempotency. A double-tap must produce one accept.
// ---------------------------------------------------------------------------
async function testIdempotency(iterations = 25) {
  console.log(`\n  Test 4 — idempotent accept under double-tap (${iterations} iterations)`);
  let bad = 0, detail = '';
  for (let i = 0; i < iterations; i++) {
    const s = await seed();
    await call('SELECT shortlist_referral($1,$2,$3)',
      [s.referralId, s.poster, s.therapists.map(t => t.userId)]);
    const t = s.therapists[0];
    const key = uuid();

    // Same key, fired concurrently — the flaky-mobile double-tap §8D names.
    const results = await race([
      () => call('SELECT accept_referral($1,$2,$3,$4,$5::interval,$6::interval)',
        [s.referralId, t.interestId, t.userId, key, '24 hours', DELAY]),
      () => call('SELECT accept_referral($1,$2,$3,$4,$5::interval,$6::interval)',
        [s.referralId, t.interestId, t.userId, key, '24 hours', DELAY]),
    ]);
    const okCount = results.filter(r => r.status === 'fulfilled').length;
    const bodies = results.filter(r => r.status === 'fulfilled')
      .map(r => JSON.stringify(r.value.rows[0].accept_referral));

    const { rows: [c] } = await pool.query(`
      SELECT (SELECT count(*) FROM referral_interest WHERE referral_id=$1 AND status='accepted') AS accepted,
             (SELECT count(*) FROM referral_events WHERE referral_id=$1 AND event_type='accepted') AS events,
             (SELECT count(*) FROM idempotency_keys WHERE key=$2) AS keys
    `, [s.referralId, key]);

    const sameBody = bodies.length < 2 || bodies[0] === bodies[1];
    if (+c.accepted !== 1 || +c.events !== 1 || +c.keys !== 1 || okCount === 0 || !sameBody) {
      bad++;
      detail = `iter ${i}: ok=${okCount} accepted=${c.accepted} events=${c.events} keys=${c.keys} sameBody=${sameBody}`;
    }
  }
  check('a repeated key yields one accept and one stored response', bad === 0, detail);
  check('no duplicate accepted event is written', bad === 0, detail);
}

// ---------------------------------------------------------------------------
// Test 5 — aggregate concurrency across MANY DIFFERENT referrals.
// Tests the connection layer, not the row-locking logic. Against Hyperdrive this
// is the pool-exhaustion test; here it establishes the functions don't deadlock
// or serialise against each other across unrelated referrals.
// ---------------------------------------------------------------------------
async function testPoolLoad(referrals = 60) {
  console.log(`\n  Test 5 — aggregate load across ${referrals} different referrals`);
  const seeds = [];
  for (let i = 0; i < referrals; i++) seeds.push(await seed());

  const started = Date.now();
  const results = await race(seeds.flatMap(s => [
    async () => {
      await call('SELECT shortlist_referral($1,$2,$3)',
        [s.referralId, s.poster, s.therapists.map(t => t.userId)]);
      const t = s.therapists[Math.floor(Math.random() * 2)];
      return call('SELECT accept_referral($1,$2,$3,$4)',
        [s.referralId, t.interestId, t.userId, uuid()]);
    },
  ]));
  const elapsed = Date.now() - started;

  const rejected = results.filter(r => r.status === 'rejected');
  const { rows: [inv] } = await pool.query(`
    SELECT count(*) FILTER (WHERE status='accepted') AS accepted_refs FROM home_case_referrals
  `);
  const { rows: [dup] } = await pool.query(`
    SELECT count(*) AS n FROM (
      SELECT referral_id FROM referral_interest WHERE status='accepted'
      GROUP BY referral_id HAVING count(*) > 1) x
  `);

  check(`all ${referrals} concurrent flows completed without error`, rejected.length === 0,
    rejected.length ? rejected[0].reason?.message : '');
  check('no referral ends with more than one accepted interest', +dup.n === 0);
  console.log(`    · ${referrals} shortlist+accept flows in ${elapsed}ms (${(elapsed/referrals).toFixed(1)}ms/flow)`);
}

(async () => {
  const { rows: [v] } = await pool.query('SELECT version()');
  console.log(`\nPhase 0.5 — referral engine invariants`);
  console.log(`  ${v.version.split(',')[0]}`);
  console.log(`  ${CONN.replace(/:\/\/.*@/, '://***@')}`);

  await testAcceptRace();
  await testShortlistCap();
  await testLapseVsAccept();
  await testIdempotency();
  await testPoolLoad();

  console.log(`\n${'─'.repeat(60)}`);
  if (failures.length === 0) {
    console.log(`ALL PASS — ${passes} invariant checks`);
  } else {
    console.log(`FAILURES (${failures.length}):`);
    failures.forEach(f => console.log(`  ✗ ${f}`));
  }
  await pool.end();
  process.exit(failures.length ? 1 : 0);
})();
