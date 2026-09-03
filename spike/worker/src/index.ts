// Phase 0.5 spike Worker — the deployed half. Everything the local suite and
// the Supabase-MCP run (spike/README.md) could NOT prove: real concurrency
// through Hyperdrive's connection pool, reached the way the real app will
// reach it. Throwaway — delete/undeploy once results are recorded.
//
// Endpoints (all POST unless noted):
//   GET  /health          — SELECT 1 through Hyperdrive
//   /setup                — (re)create the phase05_spike schema + functions
//   /teardown             — drop it
//   /run-all              — setup, run every correctness test, return one report
//   /pool-load?n=60        — the aggregate concurrency test alone, N tunable
//
// Auth: none. This is a throwaway spike Worker with a random path prefix
// left off deliberately for simplicity — undeploy it when done, don't leave
// it live pointed at real infrastructure.

import postgres from 'postgres';
import { SETUP_SQL, FUNCTIONS_SQL, TEARDOWN_SQL } from './schema';

export interface Env {
  HYPERDRIVE: { connectionString: string };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function sqlFor(env: Env) {
  // prepare: false — Hyperdrive's origin here is Supabase's transaction-mode
  // pooler (port 6543); named prepared statements don't survive pooled
  // connections being handed to different backends between statements.
  // Hyperdrive's origin_connection_limit on ahpnetworkdb is 20 — stay well under it.
  // Found via /run-all against real infra: max:30 produced 'write CONNECTION_CLOSED'
  // mid-run, most likely from exceeding this cap (compounded by Supabase's own
  // pooler underneath). Worth calibrating for real in Phase 6 rather than assuming.
  // connect_timeout/idle_timeout set explicitly so a stuck connection attempt
  // fails fast with a diagnosable error instead of silently exhausting the
  // default (much longer) postgres.js timeout.
  return postgres(env.HYPERDRIVE.connectionString, {
    prepare: false,
    max: 8,
    connect_timeout: 10,
    idle_timeout: 20,
  });
}

async function seedReferral(sql: ReturnType<typeof postgres>, therapistCount = 2) {
  const [poster] = await sql`INSERT INTO phase05_spike.users (name) VALUES ('poster') RETURNING id`;
  const therapists: { id: string }[] = [];
  for (let i = 0; i < therapistCount; i++) {
    const [t] = await sql`INSERT INTO phase05_spike.users (name) VALUES (${'t' + i}) RETURNING id`;
    therapists.push(t as { id: string });
  }
  const [ref] = await sql`
    INSERT INTO phase05_spike.home_case_referrals (posted_by_user_id)
    VALUES (${poster.id}) RETURNING id`;
  const interests: { id: string; therapist_user_id: string }[] = [];
  for (const t of therapists) {
    const [ri] = await sql`
      INSERT INTO phase05_spike.referral_interest (referral_id, therapist_user_id)
      VALUES (${ref.id}, ${t.id}) RETURNING id, therapist_user_id`;
    interests.push(ri as { id: string; therapist_user_id: string });
  }
  return { posterId: poster.id as string, referralId: ref.id as string, interests };
}

async function shortlist(sql: ReturnType<typeof postgres>, referralId: string, posterId: string, therapistIds: string[], offerWindow = '4 hours', testDelay = '0') {
  return sql`SELECT phase05_spike.shortlist_referral(${referralId}, ${posterId}, ${therapistIds}, ${offerWindow}::interval, ${testDelay}::interval) AS result`;
}

async function accept(sql: ReturnType<typeof postgres>, referralId: string, interestId: string, therapistId: string, key: string, testDelay = '0') {
  return sql`SELECT phase05_spike.accept_referral(${referralId}, ${interestId}, ${therapistId}, ${key}, '24 hours'::interval, ${testDelay}::interval) AS result`;
}

async function lapse(sql: ReturnType<typeof postgres>, referralId: string, testDelay = '0') {
  return sql`SELECT phase05_spike.lapse_offers(${referralId}, ${testDelay}::interval) AS result`;
}

// Fires a batch of promises without sequencing them — the actual race.
const race = <T,>(fns: (() => Promise<T>)[]) => Promise.allSettled(fns.map((f) => f()));

type Check = { name: string; ok: boolean; detail?: string };

async function testAcceptRace(sql: ReturnType<typeof postgres>, iterations = 6): Promise<Check> {
  let bad = 0, detail = '';
  for (let i = 0; i < iterations; i++) {
    const s = await seedReferral(sql, 2);
    await shortlist(sql, s.referralId, s.posterId, s.interests.map((x) => x.therapist_user_id));
    const results = await race(s.interests.map((it) => () =>
      accept(sql, s.referralId, it.id, it.therapist_user_id, crypto.randomUUID(), '0.25')));
    const won = results.filter((r) => r.status === 'fulfilled').length;
    const [inv] = await sql`
      SELECT
        (SELECT count(*) FROM phase05_spike.referral_interest WHERE referral_id=${s.referralId} AND status='accepted') AS accepted,
        (SELECT count(*) FROM phase05_spike.referral_interest WHERE referral_id=${s.referralId} AND status='not_selected') AS not_selected,
        (SELECT count(*) FROM phase05_spike.referral_interest WHERE referral_id=${s.referralId} AND status='shortlisted') AS dangling,
        (SELECT status FROM phase05_spike.home_case_referrals WHERE id=${s.referralId}) AS ref_status`;
    if (won !== 1 || +inv.accepted !== 1 || +inv.not_selected !== 1 || +inv.dangling !== 0 || inv.ref_status !== 'accepted') {
      bad++; detail = `iter ${i}: winners=${won} accepted=${inv.accepted} not_selected=${inv.not_selected} dangling=${inv.dangling} status=${inv.ref_status}`;
    }
  }
  return { name: `accept-race (${iterations}x, over Hyperdrive)`, ok: bad === 0, detail: bad ? detail : `${iterations}/${iterations} clean` };
}

async function testShortlistCap(sql: ReturnType<typeof postgres>, iterations = 6): Promise<Check> {
  let bad = 0, detail = '';
  for (let i = 0; i < iterations; i++) {
    const s = await seedReferral(sql, 4);
    const [a, b] = s.interests;
    const [c, d] = s.interests.slice(2);
    const results = await race([
      () => shortlist(sql, s.referralId, s.posterId, [a.therapist_user_id, b.therapist_user_id], '4 hours', '0.25'),
      () => shortlist(sql, s.referralId, s.posterId, [c.therapist_user_id, d.therapist_user_id], '4 hours', '0.25'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const [cnt] = await sql`SELECT count(*) AS n FROM phase05_spike.referral_interest WHERE referral_id=${s.referralId} AND status='shortlisted'`;
    if (+cnt.n > 2 || ok !== 1) { bad++; detail = `iter ${i}: succeeded=${ok} shortlisted=${cnt.n}`; }
  }
  return { name: `shortlist-cap (${iterations}x, over Hyperdrive)`, ok: bad === 0, detail: bad ? detail : `${iterations}/${iterations} clean` };
}

async function testLapseVsAccept(sql: ReturnType<typeof postgres>, iterations = 6): Promise<Check> {
  let bad = 0, detail = '';
  for (let i = 0; i < iterations; i++) {
    const s = await seedReferral(sql, 2);
    await shortlist(sql, s.referralId, s.posterId, s.interests.map((x) => x.therapist_user_id), '0 seconds');
    const it = s.interests[0];
    const results = await race([
      () => accept(sql, s.referralId, it.id, it.therapist_user_id, crypto.randomUUID(), '0.25'),
      () => lapse(sql, s.referralId, '0.25'),
    ]);
    const [inv] = await sql`
      SELECT
        (SELECT count(*) FROM phase05_spike.referral_interest WHERE referral_id=${s.referralId} AND status='accepted') AS accepted,
        (SELECT count(*) FROM phase05_spike.referral_interest WHERE referral_id=${s.referralId} AND status='missed') AS missed,
        (SELECT status FROM phase05_spike.home_case_referrals WHERE id=${s.referralId}) AS ref_status`;
    const acceptOk = results[0].status === 'fulfilled';
    const legal = acceptOk
      ? (+inv.accepted === 1 && inv.ref_status === 'accepted' && +inv.missed === 0)
      : (+inv.accepted === 0 && inv.ref_status === 'open' && +inv.missed === 2);
    if (!legal) { bad++; detail = `iter ${i}: acceptOk=${acceptOk} accepted=${inv.accepted} missed=${inv.missed} status=${inv.ref_status}`; }
  }
  return { name: `lapse-vs-accept (${iterations}x, over Hyperdrive)`, ok: bad === 0, detail: bad ? detail : `${iterations}/${iterations} clean` };
}

async function testIdempotency(sql: ReturnType<typeof postgres>, iterations = 6): Promise<Check> {
  let bad = 0, detail = '';
  for (let i = 0; i < iterations; i++) {
    const s = await seedReferral(sql, 2);
    await shortlist(sql, s.referralId, s.posterId, s.interests.map((x) => x.therapist_user_id));
    const it = s.interests[0];
    const key = crypto.randomUUID();
    const results = await race([
      () => accept(sql, s.referralId, it.id, it.therapist_user_id, key, '0.25'),
      () => accept(sql, s.referralId, it.id, it.therapist_user_id, key, '0.25'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const [cnt] = await sql`
      SELECT (SELECT count(*) FROM phase05_spike.referral_interest WHERE referral_id=${s.referralId} AND status='accepted') AS accepted,
             (SELECT count(*) FROM phase05_spike.idempotency_keys WHERE key=${key}) AS keys`;
    if (+cnt.accepted !== 1 || +cnt.keys !== 1 || ok === 0) { bad++; detail = `iter ${i}: ok=${ok} accepted=${cnt.accepted} keys=${cnt.keys}`; }
  }
  return { name: `idempotent double-tap (${iterations}x, over Hyperdrive)`, ok: bad === 0, detail: bad ? detail : `${iterations}/${iterations} clean` };
}

// THE test this Worker exists for: aggregate concurrency across many
// different referrals, over Hyperdrive's actual connection pool. Nothing in
// the session that built this Worker could run this — no raw pg.Pool was
// available, only serial-ish MCP calls. This is the real §7/Phase 12 gate.
async function testPoolLoad(sql: ReturnType<typeof postgres>, n = 10): Promise<Check & { elapsedMs: number; perFlowMs: number }> {
  const seeds = [];
  for (let i = 0; i < n; i++) seeds.push(await seedReferral(sql, 2));

  const started = Date.now();
  const results = await race(seeds.map((s) => async () => {
    await shortlist(sql, s.referralId, s.posterId, s.interests.map((x) => x.therapist_user_id));
    const it = s.interests[Math.floor(Math.random() * 2)];
    return accept(sql, s.referralId, it.id, it.therapist_user_id, crypto.randomUUID());
  }));
  const elapsedMs = Date.now() - started;

  const rejected = results.filter((r) => r.status === 'rejected');
  const [dup] = await sql`
    SELECT count(*) AS n FROM (
      SELECT referral_id FROM phase05_spike.referral_interest WHERE status='accepted'
      GROUP BY referral_id HAVING count(*) > 1) x`;

  const ok = rejected.length === 0 && +dup.n === 0;
  return {
    name: `pool-load (${n} concurrent referrals, over Hyperdrive — the real §7 gate)`,
    ok,
    detail: ok ? `${n}/${n} flows clean, no pool exhaustion, no dup accepts` : `${rejected.length} rejected, ${dup.n} referrals with duplicate accepts`,
    elapsedMs,
    perFlowMs: elapsedMs / n,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const sql = sqlFor(env);

    try {
      return await handle(url, sql);
    } catch (err: any) {
      return json({
        error: err.message ?? String(err),
        code: err.code,
        errno: err.errno,
        name: err.name,
        cause: err.cause ? String(err.cause) : undefined,
      }, 500);
    } finally {
      // postgres.js holds a TCP connection per client open until told
      // otherwise — Workers don't reuse this instance across requests, so it
      // must close before the handler returns or Hyperdrive's origin
      // connection limit (20, per the existing config) leaks one per request.
      await sql.end({ timeout: 5 });
    }
  },
};

async function handle(url: URL, sql: ReturnType<typeof postgres>): Promise<Response> {
      if (url.pathname === '/health') {
        const [row] = await sql`SELECT 1 AS ok`;
        return json({ health: 'ok', db: row });
      }

      if (url.pathname === '/setup') {
        await sql.unsafe(SETUP_SQL);
        await sql.unsafe(FUNCTIONS_SQL);
        return json({ setup: 'ok' });
      }

      if (url.pathname === '/teardown') {
        await sql.unsafe(TEARDOWN_SQL);
        return json({ teardown: 'ok' });
      }

      if (url.pathname === '/setup-only') {
        await sql.unsafe(SETUP_SQL);
        await sql.unsafe(FUNCTIONS_SQL);
        return json({ setup: 'ok' });
      }

      // Individual fast checks — run /setup-only once first, then hit these one at
      // a time. Each does only a handful of iterations so it returns in a few
      // seconds even over real network latency, unlike the old do-everything /run-all.
      const iters = Number(url.searchParams.get('iters') ?? '6');
      if (url.pathname === '/test/accept-race') {
        const r = await testAcceptRace(sql, iters);
        return json(r, r.ok ? 200 : 500);
      }
      if (url.pathname === '/test/shortlist-cap') {
        const r = await testShortlistCap(sql, iters);
        return json(r, r.ok ? 200 : 500);
      }
      if (url.pathname === '/test/lapse-vs-accept') {
        const r = await testLapseVsAccept(sql, iters);
        return json(r, r.ok ? 200 : 500);
      }
      if (url.pathname === '/test/idempotency') {
        const r = await testIdempotency(sql, iters);
        return json(r, r.ok ? 200 : 500);
      }

      if (url.pathname === '/pool-load') {
        const n = Number(url.searchParams.get('n') ?? '10');
        const result = await testPoolLoad(sql, n);
        return json(result, result.ok ? 200 : 500);
      }

      if (url.pathname === '/run-all') {
        // Deliberately excludes the pool-load test — see /pool-load. Splitting these
        // means a failure in one doesn't hide or get hidden by the other, and keeps
        // each request's total query count low enough to stay comfortably inside
        // whatever connection/duration limits are actually in play here.
        await sql.unsafe(SETUP_SQL);
        await sql.unsafe(FUNCTIONS_SQL);

        const checks: Check[] = [];
        checks.push(await testAcceptRace(sql));
        checks.push(await testShortlistCap(sql));
        checks.push(await testLapseVsAccept(sql));
        checks.push(await testIdempotency(sql));

        const allOk = checks.every((c) => c.ok);
        return json({
          summary: allOk ? 'ALL PASS (correctness) — call /pool-load?n=20 next, scaling up' : 'FAILURES — see checks',
          note: 'Schema left in place for inspection. Call /teardown when done.',
          checks,
        }, allOk ? 200 : 500);
      }

      return json({
        error: 'unknown route',
        routes: ['/health', '/setup-only', '/test/accept-race?iters=6', '/test/shortlist-cap?iters=6', '/test/lapse-vs-accept?iters=6', '/test/idempotency?iters=6', '/run-all', '/pool-load?n=10', '/teardown'],
      }, 404);
}
