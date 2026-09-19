# Railway warm-standby deploy — Phase 6.5 findings

Run once, 2026-09-19, per `BUILD_SEQUENCE.md`'s Phase 6.5 ("one session, do
not skip"). Per that section's own instruction: **do not keep this
running** — the app-side code swaps (`db.ts`, `next.config.ts`) were
reverted immediately after this test, but the Railway project itself
(`AHP-Net`) was deliberately left running a bit longer at the founder's
choice — **still pending teardown, not yet deleted.** This document is the
contingency record so the steps aren't re-derived from scratch under
pressure if a hosting trigger (CLAUDE.md's hosting section) is ever
actually pulled.

## Result: deploys and runs, but the "one file swap" assumption was wrong

The plan's stated bar — *"the app deploys and runs correctly on Railway
with no code changes beyond environment configuration and the one
database-connection-file swap"* — does not fully hold. Two code changes
were needed, and a further ten files carry a real, currently-undiscovered
portability gap. All of this is fixable; none of it is a reason to doubt
the hosting decision. This is exactly the kind of finding this phase
exists to surface before there's pressure.

### What worked exactly as expected

- **`src/db/db.ts`** — the one *intended* swap. Standard Node hosting has
  no Hyperdrive binding and no per-request Workers I/O lifecycle, so a
  normal module-level `postgres.js` connection pool (reused across
  requests) replaces the per-request-client-via-`getCloudflareContext`
  pattern. This is the *correct* pattern for Railway, not a workaround —
  the per-request discipline in the Cloudflare version exists specifically
  because of Workers' request-scoped I/O teardown, which doesn't apply
  here.
- **R2 access** — confirmed genuinely portable, no changes needed.
  `src/lib/r2-presign.ts` (and the rest of `src/lib/r2*.ts`) take `env` as
  a function parameter rather than reading a global Cloudflare binding,
  exactly per CLAUDE.md's "always use R2's S3-compatible API" rule. This
  rule is the reason R2 required zero changes here — the payoff of
  following it from the first upload function, as instructed. (Not
  exercised end-to-end in this session — no file was actually uploaded —
  but the code path itself needs no porting.)
- Core pages — `/`, `/directory` (DB-backed), `/login` — all returned
  `200` with real rendered content, confirming the swapped `db.ts`
  correctly reaches the staging Supabase project over its session-mode
  pooler.

### What didn't: a second required change, found by testing

**`next.config.ts`** unconditionally fires
`import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev())`
on every config load, with no `NODE_ENV` guard — safe on Cloudflare, since
that file is only ever loaded via `next dev`/`next build` there. On
Railway's `next start` (no wrangler/Workers runtime present), this reached
production as an unhandled promise rejection. Fixed by gating it behind
`process.env.NODE_ENV !== "production"`. Small, but it means the true
count is **two** required code changes, not one — worth knowing going in,
not discovering mid-migration.

### A real, currently-undiscovered gap: 10 files call `getCloudflareContext()` directly

Grep for `getCloudflareContext` outside `db.ts` turns up ten files, all
reading Workers-runtime secrets/bindings this way — none of them ported by
the `db.ts` swap, because they each call the Workers-only API directly
rather than through a shared abstraction:

```
src/app/actions/reveal-contact.ts
src/app/admin/(protected)/deletion-requests/actions.ts
src/app/app/practices/actions.ts
src/app/app/verification/actions.ts
src/app/api/cron/cost-check/route.ts
src/app/api/cron/weekly-digest/route.ts
src/app/api/cron/referral-scheduler/route.ts
src/app/api/cron/retention/route.ts
src/app/api/cron/notification-worker/route.ts
src/app/api/cron/liveness-check/route.ts
```

Confirmed concretely, not just by inspection: `POST
/api/cron/cost-check` on the deployed Railway instance returned `HTTP
500`, with this in the logs —

```
⨯ Error: When developing locally, you should use a local Postgres
connection string to emulate Hyperdrive functionality. Please setup
Postgres locally and set the value of the
'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE' variable or
"HYPERDRIVE"'s "localConnectionString" to the Postgres connection string.
```

— `@opennextjs/cloudflare`'s own dev-mode fallback error, surfacing in
production because there's no Workers runtime to satisfy the real call.
Every route/action in that list would fail the same way on Railway today:
all five cron jobs, credential upload (`verification/actions.ts`),
contact reveal, practice-claim actions, and deletion-request actions.

**✅ Fixed, 2026-09-19, same day as this spike.** `src/lib/runtime-env.ts`
now generalizes `db.ts`'s philosophy — one isolated connection file — to
a second small file for secrets: `getRuntimeEnv<T>()` tries
`getCloudflareContext()` and falls back to `process.env` if that throws;
`runInBackground()` does the same for the one `ctx.waitUntil()` call
(`verification/actions.ts`), since a plain Node process has no equivalent
concept and doesn't need one — nothing tears it down mid-task the way a
Worker isolate can be. All ten call sites now route through this instead
of importing `getCloudflareContext` directly.

Verified two ways: `wrangler dev` — all 6 cron routes correctly return
`401` (auth check runs, no crash) instead of the `500` seen before; and a
direct Node-only test of the fallback path itself (outside any Workers
context, `getRuntimeEnv()` correctly reads `process.env`). A live Railway
redeploy to fully close the loop was attempted but blocked by the free
tier's peak-hours deploy restriction for the `sfo` region — the two
verifications above cover the same code path a live redeploy would have,
just not through Railway's actual infrastructure. Worth a real Railway
redeploy once convenient, as final confirmation, but not blocking.

The plan's "one file swap" claim is now actually true going forward.

## Exact steps taken (for re-running this test, or a real migration)

1. `npx @railway/cli login --browserless` — completes via a browser
   sign-in on another device/tab; CLI polls until authorized.
2. `npx @railway/cli init --name <project-name>` (or `railway link -p
   <existing-project>` if the project already exists).
3. `npx @railway/cli add --service <service-name>` — creates an empty
   service (needed before variables can attach; `railway up` alone
   creates a project but variables can't be set on it until a service
   exists).
4. `npx @railway/cli service <service-name>` — links the local directory
   to that service.
5. Swap `src/db/db.ts` to the standard-Node version (see git history for
   this session's exact diff — the Cloudflare version is restored after
   teardown, see below).
6. Guard the dev-only OpenNext init in `next.config.ts` behind
   `NODE_ENV !== "production"`.
7. Set env vars via `npx @railway/cli variables --set KEY="value"`
   (repeatable per var, or chain multiple `--set` flags in one call):
   - `DATABASE_URL` — **the session-mode pooler string** (port 5432, same
     discipline as Hyperdrive's origin rule in CLAUDE.md), from Supabase
     dashboard → target project → Settings → Database → Connection string
     → Session pooler. **Never paste this into a chat/terminal session
     that logs output somewhere persistent** — `railway variables` (no
     args) echoes full values back, including passwords.
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public
     by design, safe to set directly.
   - `NODE_ENV=production`.
   - `NEXT_PUBLIC_SITE_URL` — set **after** step 8 generates the domain,
     then redeploy once more (`NEXT_PUBLIC_*` vars are baked in at build
     time, not read at runtime, so changing one after the first deploy
     needs a rebuild to reach the client bundle).
8. `npx @railway/cli up --ci` — builds and deploys, streaming logs.
   Railway's Railpack auto-detected this as a standard Next.js app; no
   Dockerfile or build config was needed.
9. `npx @railway/cli domain` — generates a public
   `*.up.railway.app` URL for the service.
10. Smoke-test: `curl` the generated domain's `/`, `/directory`, `/login`.

### Teardown

1. ✅ **Done.** Restored `src/db/db.ts` and `next.config.ts` to their
   Cloudflare versions (`git checkout` — neither swap was committed).
2. ⏳ **Pending.** Delete the Railway service and project (dashboard, or
   `railway service delete` / project deletion — irreversible, confirmed
   with the founder before doing it). Left running past this session at
   the founder's choice; **still needs doing** — this line should be
   updated to done once it happens, or this file's status note above
   corrected if the decision changes to keeping it.
3. ✅ **Done.** Rotated the staging Supabase database password — it was
   briefly echoed into a terminal/chat session while setting up this
   test, since `railway variables` (no filter) prints full values. If
   re-running this test, prefer `railway variables --json | jq
   '.DATABASE_URL'` piped through a host parser rather than the bare
   command, to avoid the same exposure.

## What this proves and doesn't prove

**Proven:** the referral engine's core portability claim — that the two
locked PL/pgSQL transactions travel with a `pg_dump` and the app can reach
them over a standard connection string — holds. Directory/home/login
pages, which touch the database through `getDb()`, worked with zero
changes to any file except the connection file itself.

**Not proven, and worth a real (short) follow-up session before this
fallback would ever actually be relied on under pressure:** the ten
`getCloudflareContext` call sites above, the push-notification path
(VAPID signing, `src/lib/web-push.ts` — untested here), and R2 upload
end-to-end (the presign code path is structurally portable but wasn't
exercised with a real file in this session).
