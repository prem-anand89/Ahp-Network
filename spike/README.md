# Phase 0.5 — referral engine spike

Per `BUILD_SEQUENCE.md` Phase 0.5. **This directory is throwaway.** What survives it is
`sql/002_functions.sql` (the three transitions Phase 6 wires up) and `src/invariants.mjs`
(the tests that become the Phase 12 launch gate). The tables in `sql/001_schema.sql` are
minimal stand-ins, not the real schema.

## Run it

```bash
service postgresql start
psql -h 127.0.0.1 -U postgres -c 'CREATE DATABASE ahp_spike'
psql -h 127.0.0.1 -U postgres -d ahp_spike -f sql/001_schema.sql
psql -h 127.0.0.1 -U postgres -d ahp_spike -f sql/002_functions.sql
npm install
node src/invariants.mjs         # the invariant suite
node src/negative-control.mjs   # proves the suite can fail
```

Point `SPIKE_DATABASE_URL` at any Postgres to run elsewhere.

## Status — what is and is not proven

| # | Phase 0.5 item | Status |
|---|---|---|
| 1 | Race correctness — concurrent accepts, same referral | **✅ Proven three times.** 25 iterations locally under forced contention; 3 iterations against the real Supabase project via direct SQL; **6/6 clean through the deployed Worker over Hyperdrive** |
| 2 | Aggregate concurrency across many referrals | **✅ Proven.** 20 concurrent referral flows (shortlist + accept each) through the deployed Worker over Hyperdrive: 20/20 clean, no pool exhaustion, no duplicate accepts, ~154ms/flow |
| 3 | Lapse vs accept | **✅ Proven three times.** 25 iterations locally; 1 iteration against the real project via direct SQL; **6/6 clean through the deployed Worker over Hyperdrive** |
| 3b | Shortlist cap under concurrency | **✅ Proven twice more.** Direct-SQL run against the real project, then **6/6 clean through the deployed Worker over Hyperdrive** |
| 3c | Idempotent double-tap | **✅ Proven twice more.** Direct-SQL run against the real project, then **6/6 clean through the deployed Worker over Hyperdrive** |
| 4 | Google Cloud Vision from a Worker | **Not started** — needs GCP Vision API access; blocked separately on the founder's GCP billing activation |
| 5 | VAPID signing on Workers | **Not started** — needs keys |
| 6 | `wrangler deploy` + Hyperdrive binding, deployed Worker reachable | **✅ Proven.** Worker deployed to `ahp-network.theranetconnect.workers.dev` with Hyperdrive binding wired, via Codespaces + API token (dashboard-based deploy proved unreliable — see below). `wrangler dev` itself (vs. `wrangler deploy`) was not separately exercised; low-risk gap given the deployed Worker's behavior is now directly proven. |

**Items 1–3c and 6 are now fully proven through the deployed Worker itself — the thing Phase 0.5 exists to prove.** Items 4–5 remain the only open gaps, both individually scoped per §B1 (Supabase Edge Function fallback if Workers can't run them, not a hosting-decision question).

**What changed since the previous pass:** a real, separate Supabase project for AHP Network
(`nbwuiynmgmnkvkdwioux`, Postgres 17.6, `ap-southeast-2`) exists, correctly apart from
`thera-net` (the Clinic EMR). A Worker was deployed (`ahp-network.theranetconnect.workers.dev`)
with a Hyperdrive binding, and every correctness test plus the pool-load test was run against
it directly — not simulated via parallel tool calls, but real concurrent HTTP requests inside
the Worker's own `fetch` handler, exactly how the production app will exercise these functions.

### A real infrastructure bug found and fixed along the way

**Every deployed-Worker request initially failed** with a genuine Postgres wire-protocol error
(`SQLSTATE 58000`, `"Timed out while waiting for an open slot in the pool"`) — including a bare
`SELECT 1` on `/health`. `pg_stat_activity` on the real database showed almost no active backend
connections at the time, ruling out real load or leaked connections as the cause.

**Root cause: the Hyperdrive config's origin pointed at Supabase's *transaction-mode* pooler
(port 6543, Supavisor).** Hyperdrive already pools connections on the Worker's behalf; stacking
it on top of *another* transaction-mode pooler creates two layers with conflicting
connection-lifecycle assumptions, and Supavisor's own pool refused new clients even though the
underlying database was nearly idle. **Fix: point Hyperdrive's origin at Supabase's
*session-mode* pooler instead (same host, port 5432)** — a Cloudflare-account-level config
change (`hyperdrive_config_edit`), no code change. Every request succeeded immediately
afterward (`/health` went from a 30-second hang to 0.6 seconds).

**This is a real Phase 0 finding, not a spike-only quirk: `db.ts`'s Hyperdrive origin must be
Supabase's session-mode pooler, never the transaction-mode pooler**, regardless of what mode
Hyperdrive itself presents to the Worker. `prepare: false` remains correct either way — it's
about Hyperdrive's own connection reuse, not the origin's pooling mode.

### How the real-project run was actually done, and what that limits

There is no raw Postgres connection string available in this session — only the Supabase
MCP's `execute_sql`/`apply_migration`, which call through Supabase's management API rather
than opening a `pg` connection pool. That rules out reusing `src/invariants.mjs` verbatim
(it needs a real `pg.Pool` to fire dozens of truly concurrent queries cheaply). Instead:

- The schema and all three functions were loaded into an isolated `phase05_spike` schema
  in the *real* project (never `public`), via `apply_migration`, so nothing here can collide
  with whatever Phase 0's actual migrations create later. Each function carries its own
  `SET search_path = phase05_spike` so it resolves correctly regardless of the caller's session.
- Concurrency was produced by firing multiple `execute_sql` tool calls **in the same
  assistant turn**, which this harness dispatches as genuinely parallel HTTP requests — not
  by a connection-pooled Node script. The `p_test_delay` seam (already in `002_functions.sql`)
  held each critical window open for 3 seconds to make the race deterministic rather than a
  matter of network jitter.
- This proves the *function logic* is correct on real Postgres 17, reached over the real
  network path, under real concurrent calls. It does **not** re-prove the negative control
  (that a broken function actually fails) — that was already established exhaustively
  locally (300 iterations, 25/25 discriminating) and repeating it here would mean briefly
  deploying deliberately-broken logic into real infrastructure for a result already known.
  It also does **not** touch Hyperdrive at all — every call above went straight to Supabase,
  bypassing the pooler entirely, since no Worker binding exists yet.

### A harness bug this run caught, worth carrying forward

The first two seed queries against the real project built `shortlist_referral(...)` inside a
CTE that was never referenced in the outer `SELECT`. Postgres silently dropped it as dead
code — the shortlist call never executed, both referrals stayed `open`, and four straight
`accept_referral` calls failed with `AHP03` for a boring reason (nothing to accept) that
briefly looked like a real finding. **Lesson for any future SQL test harness: a CTE wrapping
a side-effecting function call must be referenced in the final `SELECT`, or Postgres's planner
is free to skip it entirely.** Postgres treats a plain `SELECT some_function(...)` CTE as pure
and eligible for dead-code elimination if unreferenced — only genuinely writable CTEs
(`INSERT`/`UPDATE`/`DELETE`) are guaranteed to execute regardless of whether they're selected.

The existing `thera-net` Supabase project is the **Thera.Net Clinic EMR**, carrying real
patient records — out of bounds under the plan's §1 product boundary and never touched by
any of this.

## What the spike found

**1. The first version of these tests proved nothing.** They passed against functions with
the row lock removed. Two `pool.query` calls fired from Node complete sequentially far more
often than they overlap — each function runs in ~2ms, so the critical window closes before
the second caller reaches it. 300 iterations against a deliberately broken function produced
**zero** violations.

The fix is the `p_test_delay` seam: a trailing parameter, defaulting to zero and never passed
by application code, that holds the window open. With it, the broken function fails 25/25 and
the correct one passes 25/25. **`src/negative-control.mjs` runs both and is part of the suite** —
a concurrency test nobody has watched fail is not evidence.

This generalises past this spike: any future concurrency test here needs a negative control
before its passing result means anything.

**2. The row lock is load-bearing for the shortlist cap, not for accept.** With `FOR UPDATE`
removed, cap violations are total (25/25) but accept-race violations stay at zero. Accept is
already protected by its conditional `UPDATE ... WHERE status = 'shortlisted' RETURNING` plus
the `referral_one_accepted` partial unique index — two independent mechanisms. Shortlist does a
`count(*)` and *then* an `UPDATE` across separate statements, so the lock is the only thing
serialising it.

Both keep the lock. But the asymmetry is worth carrying into Phase 6 review: the cap is the
invariant with a single point of failure, so it is the one to guard hardest against a
well-meaning refactor.

**3. `CREATE OR REPLACE FUNCTION` does not replace a function whose signature changed** — it
creates an overload, and calls then fail as ambiguous (42725). `sql/002_functions.sql` drops
every prior signature explicitly before recreating. Phase 0's migration conventions should
carry this rule; it is exactly the kind of thing that works locally and breaks a deploy.

## Caveats on the results

- **Postgres 16 locally; Supabase runs 17.** Row-locking semantics are unchanged between them,
  but the suite should be re-run against the real 17 instance once it exists.
- ~~Test 5 is not the connection-pool load test the launch gate requires. It uses direct local
  connections.~~ **Resolved** — the actual Hyperdrive pool-load test now exists and passed
  (20/20 concurrent flows through the deployed Worker, see the Status table above).
- The `p_test_delay` seam reaches production code. It defaults to zero and no caller passes it,
  but it is a `pg_sleep` in a function reachable by the app role. Phase 6 should decide whether
  to keep it (tests need it) or gate it — recorded rather than quietly settled.

## Outcome — hosting bet proven, Phase 1 unblocked

**✅ Phase 0.5 complete.** All four correctness checks and the pool-load test pass through the
deployed Worker itself, over Hyperdrive, against real Supabase Postgres 17 — not simulated,
not a proxy for the real thing. The functions behave correctly under contention across every
test context tried: local Postgres 16, the real Supabase project via direct SQL, and now the
actual deployed Worker under real concurrent HTTP load. Plan §7's first fallback trigger is
cleared — the hosting decision holds.

**The one genuine infrastructure problem found (Hyperdrive pointed at Supabase's
transaction-mode pooler instead of session-mode) was a real bug, not expected behavior** — it
made every request fail, including a bare `SELECT 1`, regardless of load. Finding and fixing it
here, before Phase 1's `db.ts` exists, is exactly what Phase 0.5 is for: this would otherwise
have surfaced as a total outage the first time the real app touched the database.

Items 4 and 5 (Google Cloud Vision and VAPID signing from Workers) remain unproven but are
individually scoped: if either fails on Workers, the fix is a Supabase Edge Function per §B1 —
job-placement, not hosting. They do not gate Phase 1.

**Addendum, 2026-09-04 — the shared Worker name caused a real production incident.**
This spike's Worker was deliberately named `ahp-network` (see `worker/wrangler.toml`'s
original comment) to reuse the real Worker's Hyperdrive binding before Phase 0/1
existed. That was never undone after Phase 0.5 completed. Months later, a
`wrangler deploy` run from `spike/worker/` — while troubleshooting an unrelated
Cloudflare build failure — silently overwrote the live production app with this
throwaway test harness, publicly exposing `/run-all` and `/teardown`. Fixed by
renaming the spike Worker to `ahp-network-spike-throwaway` in `worker/wrangler.toml`.
**Lesson: a throwaway artifact that intentionally shares a name with production
infrastructure is a landmine that outlives the reason it was planted — rename or
delete it the moment its job is done, don't leave "delete this later" as the only
safeguard.**

**The `phase05_spike` schema was dropped from the real project after each run** — see
`sql/999_teardown.sql`. Nothing from this spike persists in `Ahp-Network`'s database. The
throwaway code was the tables and the test harness (`src/invariants.mjs`, `src/negative-control.mjs`);
the durable artifacts are the three PL/pgSQL functions (`sql/002_functions.sql`, the Phase 6 spec)
and the concurrency invariant tests (the Phase 12 launch gate).
