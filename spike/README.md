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
| 1 | Race correctness — concurrent accepts, same referral | **Proven twice.** 25 iterations locally under forced contention, plus 3 more iterations against the real `Ahp-Network` Supabase project (Postgres 17), fired as genuinely parallel network calls |
| 2 | Aggregate concurrency across many referrals | **Partly.** 60 concurrent flows pass locally (direct connection). Against the real project, 2 independent referrals raced simultaneously (4 concurrent calls) with correct, isolated outcomes on each — real evidence, but still not the actual Hyperdrive pool-load test, which needs a deployed Worker |
| 3 | Lapse vs accept | **Proven twice.** 25 iterations locally, plus 1 iteration against the real project — accept won, `lapse_offers` correctly no-op'd rather than clobbering the winner |
| 3b | Shortlist cap under concurrency | **Proven against the real project** (not separately itemised in the original six) — two concurrent calls requesting 4 therapists against a 2-slot cap: one succeeded with exactly 2, the other was rejected by `AHP01`, zero partial writes |
| 3c | Idempotent double-tap | **Proven against the real project** — the same key fired twice concurrently returned an identical stored response both times; exactly one accept, one event, one idempotency row |
| 4 | Google Cloud Vision from a Worker | **Not started** — needs GCP Vision API access; blocked separately on the founder's GCP billing activation |
| 5 | VAPID signing on Workers | **Not started** — needs keys |
| 6 | `wrangler dev` parity | **Not started** — a Worker (`ahp-network`) and a Hyperdrive config (`ahpnetworkdb`, pointed at the Supabase transaction-mode pooler) both exist, but the Worker is still the unmodified "Hello world" placeholder with no Hyperdrive binding wired in, and no available tool in this session can deploy to it (no `workers_put`-equivalent in the Cloudflare MCP, no `CF_API_TOKEN`/`CF_ACCOUNT_ID` for local `wrangler`) |

**What changed since the first pass:** a real, separate Supabase project for AHP Network
(`nbwuiynmgmnkvkdwioux`, Postgres 17.6, `ap-southeast-2`) now exists, correctly apart from
`thera-net` (the Clinic EMR). Items 1–3c above were re-run there. Items 4–6 remain blocked:
4 and 5 on credentials, 6 on deploy tooling this session doesn't have — a human needs to run
`wrangler deploy` (or wire the binding in the dashboard) at least once.

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
- **Test 5 is not the connection-pool load test the launch gate requires.** It uses direct local
  connections. Hyperdrive is the thing that needs testing, and it is untested.
- The `p_test_delay` seam reaches production code. It defaults to zero and no caller passes it,
  but it is a `pg_sleep` in a function reachable by the app role. Phase 6 should decide whether
  to keep it (tests need it) or gate it — recorded rather than quietly settled.

## Next

Nothing here changes the hosting decision. The functions now behave correctly under
contention on two separate real Postgres instances (local 16, and the real Supabase project's
17) — necessary, and still not sufficient: the whole point of Phase 0.5 is proving this
**over Hyperdrive, from a deployed Worker**, and that step hasn't happened. The blocker is
concrete and narrow: a Worker with the Hyperdrive binding wired in and one `wrangler deploy`
(or the equivalent dashboard action) run by a human with the right credentials. Once that
exists, re-run the same tests — ideally the original `src/invariants.mjs` against a real
connection pool through the Worker, since that is the only way to also exercise the aggregate
pool-load test (item 2) properly. Until then, plan §7's first fallback trigger is neither
fired nor cleared.

**The `phase05_spike` schema was dropped from the real project after this run** — see
`sql/999_teardown.sql`. Nothing from this pass persists in `Ahp-Network`'s database.
