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
| 1 | Race correctness — concurrent accepts, same referral | **Proven**, 25 iterations under forced contention |
| 2 | Aggregate concurrency across many referrals | **Partly** — 60 concurrent flows pass locally, but against a direct connection, *not* Hyperdrive. The real pool test still needs a deployed Worker |
| 3 | Lapse vs accept | **Proven**, 25 iterations |
| 4 | Google Cloud Vision from a Worker | **Not started** — needs GCP credentials |
| 5 | VAPID signing on Workers | **Not started** — needs keys |
| 6 | `wrangler dev` parity | **Not started** — needs a Cloudflare account |

Items 4–6 and the real form of 2 are blocked on credentials and a Supabase project for
AHP Network. The existing `thera-net` Supabase project is the **Thera.Net Clinic EMR**,
carrying real patient records — out of bounds under the plan's §1 product boundary and
not somewhere to put throwaway concurrency tables.

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

Nothing here changes the hosting decision. The functions behave correctly under contention,
which is necessary and not sufficient: the whole point of Phase 0.5 is proving they behave
that way **over Hyperdrive, from a deployed Worker**. Until items 2, 4, 5 and 6 run there,
plan §7's first fallback trigger is neither fired nor cleared.
