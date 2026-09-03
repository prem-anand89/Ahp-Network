# Phase 0.5 — the deployed half

This is what this Claude session's tools couldn't do: an actual Worker deploy
with a real Hyperdrive binding. Everything else (the schema, the three
functions, the correctness checks) was already proven — see `spike/README.md`
one level up. This Worker re-runs the same checks **through Hyperdrive**, plus
the one test that was never actually run anywhere yet: aggregate concurrency
across many referrals through a real connection pool (`/pool-load`). That's
the literal §7/Phase 12 gate.

**Throwaway, same as the rest of `spike/`.** Nothing here is meant to survive
into the real app.

## Deploy

You already have both pieces this needs — the `ahp-network` Worker and the
`ahpnetworkdb` Hyperdrive config are already showing up under your Cloudflare
account. `wrangler.toml` here targets both by name/id.

```bash
cd spike/worker
npm install
npx wrangler login          # if this machine isn't already authenticated
npx wrangler deploy
```

That deploys this code to the *existing* `ahp-network` Worker — it will
overwrite the current "Hello world" placeholder. Since the whole Worker is
throwaway for this phase, that's fine; Phase 0's real scaffolding will
overwrite it again properly.

## Run it

Once deployed, wrangler prints the Worker's URL (`https://ahp-network.<your-subdomain>.workers.dev`
unless you've set a custom domain/route). Then:

```bash
curl -s https://ahp-network.<subdomain>.workers.dev/health
# {"health":"ok","db":{"ok":1}}   ← confirms the Hyperdrive binding actually works

curl -s https://ahp-network.<subdomain>.workers.dev/run-all
# runs setup + all four correctness checks + the 60-referral pool-load test,
# returns one JSON report. Takes maybe 20-40 seconds depending on Hyperdrive
# cold-start.

curl -s "https://ahp-network.<subdomain>.workers.dev/pool-load?n=150"
# re-run just the aggregate test at higher concurrency if /run-all's 60 passes
# cleanly and you want to push toward where it might actually break

curl -s -X POST https://ahp-network.<subdomain>.workers.dev/teardown
# drops the phase05_spike schema when you're done
```

Send me the `/run-all` output (or just tell me it's deployed and I'll hit it
myself if I have network access to the URL — otherwise paste the JSON back)
and I'll fold the results into `spike/README.md` and close out Phase 0.5's
remaining hosting-trigger question in `ARCHITECTURE_REVIEW.md`.

## What "pass" and "fail" actually mean here

Same as the local suite: every check has a **negative control already proven
locally** (see `spike/src/negative-control.mjs` — the row lock genuinely
matters, 25/25 discriminating). This Worker isn't re-proving that the logic
*can* fail; it's proving the *correct* logic still holds once real network
latency, Hyperdrive's pooling, and genuine multi-referral concurrency are
all in the loop at once — which is the one combination nothing before this
could test.

If `/pool-load` fails — dropped/hung connections, duplicate accepts, or
timeouts under load — that is exactly plan §7's first hosting-fallback
trigger firing, and it fires *here*, in a throwaway spike, rather than at
Phase 12 with five phases built on top of the assumption.
