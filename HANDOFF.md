# Live handoff — read this first, every session, either tool

This is the rotating baton between Claude Code and Antigravity (or any
other tool working this repo). Unlike `HANDOFF_VSCODE.md` (a one-time
bridge doc, written once and rarely touched again), **this file changes
constantly** — whoever finishes a session updates it before stopping, and
whoever starts a session reads it first, before touching any code.

**The rule is simple: read this file first. Update it last, before you
stop — even mid-task.** If it's stale or contradicts what you find in the
repo (e.g. it says a task is "in progress" but `git log` shows it was
finished and committed), trust the repo and fix this file, don't trust
this file over the repo.

**Second standing rule, added 2026-09-19: only Claude Code pushes to
`main`.** Antigravity (or any other tool) commits its work locally, or to
a feature branch, and updates this file to say what's ready for review —
never `git push origin main` directly. Reason, not just process for its
own sake: a push to `main` triggers the production deploy workflow, and
the first time this handoff pattern ran, a diff review before push caught
a real bug (see `directory/page.tsx`'s Radix Select revert in git log
around 2026-09-19) that following the task brief's own instructions
wouldn't have caught — Radix's empty-string-value constraint and a
page-specific "deliberately no client JS" architecture note, neither
flagged by name in the brief. This is cheap insurance, not a comment on
work quality.

## Right now

**Status:** idle — no task currently assigned to either tool.

**Last updated by:** Claude Code, 2026-09-21.

**Last completed — the design-system & product overhaul.** Separate initiative
from `BUILD_SEQUENCE.md` (that document's Phases 0–11 were already complete
before this started — see its new status line). Executed from the plan
`partitioned-snacking-panda.md` (not checked into this repo; ask the founder or
regenerate from this handoff + `ARCHITECTURE_REVIEW.md` §I if it's needed again).
All 5 phases shipped, committed to `main` locally, not yet pushed:

- **Phase 1 — tokens, type, nav, hero, empty/loading states, `/design`, admin
  doc viewer.** Real token layer (paper/ink/jade/brick, Newsreader/Inter/IBM
  Plex Mono), floating island nav + bottom tab bar, `/design` kitchen-sink
  preview, ~10 new shadcn primitives, admin credential document viewer.
- **Phase 2 — data unlock.** `/app/profile/edit` (writes `photoUrl`,
  `specializations`, `bio`, `ageGroupsServed`, `yearsExperience`, `languages`),
  photo upload (client-side compress, EXIF-stripped fallback, R2 presigned PUT),
  specialization taxonomy expansion (ENUM → TEXT+CHECK), capacity states +
  21-day staleness.
- **Phase 3 — public depth.** Public Verification Record (`/pt/[slug]/verification`),
  `/pt/[slug]` rebuild, directory polish, locality landing pages
  (`/in/[city]/[locality][/role]`, deliberately `force-dynamic` not ISR — see
  `ARCHITECTURE_REVIEW.md` §I), practice profiles (`/app/practices`, claim/edit,
  real `/clinic/[slug]`), reveal-contact hardening (rate caps, audit log,
  `Sec-Fetch-Site` check — Turnstile still not wired in, no keys exist yet).
- **Phase 4 — referral + credential loop correctness.** Fixed the offer-window
  bug (urgency now actually changes the countdown), fixed the referral board's
  wrong state line, rebuilt `candidate-card.tsx` and `countdown.tsx`, fixed the
  credential re-upload dead-end, added re-type-the-registration-number on admin
  approve, added the case brief (write-once poster→accepter handoff — deliberately
  not messaging, see `ARCHITECTURE_REVIEW.md` §I).
- **Phase 5 — trust features.** Rolodex circles (name search, no reload), peer
  notes (never a count, completed-referral-gated), circle-first referrals
  (disabled for urgent), referral receipt (`/r/[code]`, per-referral never
  per-person).
- **Two post-hoc fixes, same push batch:** `next.config.ts` now has
  `images.remotePatterns` for R2's `*.r2.dev` domain (dormant until
  `NEXT_PUBLIC_PHOTOS_BASE_URL` is set); a third-party review's two claims
  (a fabricated "native checkbox" rule, a Worker-OOM image-resizing claim)
  were checked against the actual code and both were wrong — see git log
  message on `6294bc5` for the full reasoning, not repeated here.

**Verification status:** `npm test` (513 tests), `npm run build`,
`node scripts/check-public-routes-static.mjs`, and `npx tsc --noEmit` all clean
as of the last commit. `npx eslint .` has 4 pre-existing errors + 1 warning not
yet triaged (impure `Date.now()` in two components' render paths, a `setState`
inside a `useEffect` in onboarding, an unescaped apostrophe on `/design`, an
anonymous default export in `worker.js`) — none block build or tests, flagged
for the next session to fix or explicitly accept.

**Open items, not yet assigned to either tool:**
1. Push everything above to `origin/main` via VS Code Source Control (only
   Claude Code pushes, per the rule below — but pushing itself, the mechanical
   act, is the founder's step per `CLAUDE.md`/this file's own convention).
2. Triage the 5 lint findings above.
3. Turnstile keys for reveal-contact — founder-provided Cloudflare site/secret
   keys, then wire them into `src/app/actions/reveal-contact.ts`.
4. `NEXT_PUBLIC_PHOTOS_BASE_URL` — turn on R2 public bucket access in the
   Cloudflare dashboard, set the env var, confirm `next.config.ts`'s new
   `remotePatterns` actually resolves a real photo end-to-end.
5. Peer notes are code-complete but should not be flipped on for real users
   until the pilot has actual completed referrals (rollout-timing call, not a
   code gate).
6. ✅ **Done, 2026-09-19 (Claude Code).** The Railway `getCloudflareContext`
   portability gap is fixed — see `src/lib/runtime-env.ts` and
   `RAILWAY_DEPLOY.md`'s updated "recommended fix" section for the full
   verification. Committed and deployed.
7. **Decided, 2026-09-19: the Railway `AHP-Net` project stays running
   indefinitely — founder's explicit call, not a pending cleanup task.**
   This is a deliberate departure from `BUILD_SEQUENCE.md`'s Phase 6.5
   instruction to tear it down after one session; noted here so it
   doesn't get "cleaned up" by a future session mistaking it for
   leftover state. If ever convenient, a full Railway redeploy of the
   `runtime-env.ts` fix (blocked earlier by the free tier's peak-hours
   restriction for the `sfo` region) would give final live confirmation
   — see `RAILWAY_DEPLOY.md` — but this is optional, not owed.

**Historical note, kept for context:** the "migrated batch 1/2/3 to shadcn
components" entries that used to be here (Antigravity, 2026-09-19, plus the
`directory/page.tsx` Radix Select revert) are superseded by Phase 1's component
work above, which rebuilt the primitive layer from scratch on the new token
system. The Radix-Select-on-a-no-client-JS-page finding is still good general
guidance for future work on `(public)/*` pages — worth rereading before
touching `directory/page.tsx` again, since the deliberate-no-client-JS
constraint didn't change even though the Select components did.


