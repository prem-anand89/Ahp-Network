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

## Right now

**Status:** idle — no task currently assigned to either tool.

**Last updated by:** Claude Code, 2026-09-19.

**Last completed:** Phase 6.5 Railway portability spike
(`RAILWAY_DEPLOY.md`), shadcn migration of 3 priority forms, both interim
legal docs, retired-Sydney-project cleanup. All committed on `main`.

**Open items, not yet assigned to either tool:**
1. Handed to Antigravity now (see task brief below) — the remaining 18
   raw-HTML forms.
2. The Railway spike found a real portability gap: 10 files call
   `getCloudflareContext()` directly for secrets, none of them portable
   off Cloudflare Workers today. See `RAILWAY_DEPLOY.md`'s "recommended
   fix" section. Not started. **Claude Code territory** (touches
   env/secrets access patterns close to the locked connection-file
   discipline) — don't pick this up in Antigravity.
3. The Railway spike project (`AHP-Net`) is still live on Railway,
   left running at the founder's choice — teardown pending whenever
   the founder wants it deleted.

## Task brief: shadcn migration, remaining 18 forms

**Assigned to:** Antigravity / Gemini.
**Do not touch:** anything under `src/db/`, `src/lib/authz.ts`,
`src/app/api/cron/*`, retention/purge logic, or anything implementing
`shortlist_referral`/`accept_referral`/`lapse_offers`. Pure UI work only.

**Before starting:** read `/CLAUDE.md` in full — non-negotiable rules
apply regardless of which tool is editing. The ones most relevant to this
task specifically:
- **No ranking/scoring/star/rating language, anywhere** — don't introduce
  any while restyling a form; if a file already has some, flag it, don't
  silently "fix" it as part of this task (out of scope, needs its own
  review).
- **The three verification badges are one locked component module** —
  don't touch `src/components/badges/` or re-implement badge rendering
  inside a form you're migrating.
- **The referral posting form's un-preselected visit-type rule** — if any
  of these 18 files has a similar "no default, must actively choose"
  field, preserve that behavior exactly. Check for a comment citing
  CLAUDE.md or a `§` section number before assuming a default is safe to
  add.

**What to do:** migrate raw `<input>`/`<select>`/`<textarea>` elements to
the shadcn components already added to this repo (`src/components/ui/`:
`Input`, `Select`, `Label`, `Textarea`, `Dialog`, `Card`, `Button`). Model
the pattern on the 3 files already done — read these first, they're the
reference:
- `src/app/app/referrals/new/post-referral-form.tsx`
- `src/app/app/onboarding/onboarding-flow.tsx`
- `src/app/app/verification/credential-upload-form.tsx`

Conventions those three establish, follow them exactly:
- Import `cn` from `@/lib/utils`, never a separate `cn` package (shadcn's
  CLI tries to pull one in — don't let it; this repo already removed it
  once).
- Radix `Select` needs `name="..."` on the `Select` root for native
  `FormData` submission to keep working in forms using `<form
  action={...}>` — check whether each file's form still needs this
  before assuming controlled-state-only is enough.
- Native `<input type="radio">`, `<input type="checkbox">`, and `<input
  type="file">` stay native — no shadcn Radio/Checkbox/File component is
  in this repo yet. Only swap `<input type="text/email/etc">`,
  `<select>`, and `<textarea>`.
- Every input needs a paired `<Label htmlFor="...">`, matching the
  existing `id`.

**Remaining files** (verify this list is still current with `grep -rlE
"<input|<select|<textarea" src/ --include="*.tsx" | grep -v
"src/components/ui" | grep -v test` before starting — it may have
changed):

```
src/app/(auth)/login/login-form.tsx
src/app/(public)/directory/page.tsx
src/app/(public)/pt/[slug]/add-to-circle-button.tsx
src/app/admin/(protected)/deletion-requests/erasure-form.tsx
src/app/admin/(protected)/deletion-requests/export-form.tsx
src/app/admin/(protected)/feedback/page.tsx
src/app/admin/(protected)/grievance/page.tsx
src/app/admin/(protected)/practice-claims/page.tsx
src/app/admin/(protected)/team-roles/assign-role-form.tsx
src/app/admin/(protected)/verification/page.tsx
src/app/admin/verify/verify-form.tsx
src/app/app/circles/circles-manager.tsx
src/app/app/circles/[id]/circle-members-manager.tsx
src/app/app/communities/create-community-form.tsx
src/app/app/feedback/feedback-form.tsx
src/app/app/referrals/[id]/outcome/report-outcome-form.tsx
src/app/app/referrals/[id]/referral-detail-actions.tsx
src/components/community-feed.tsx
```

**Suggested batching** (don't do all 18 in one commit — smaller,
reviewable chunks, same discipline as the first 3):
1. Auth/public-facing first (`login-form.tsx`, `directory/page.tsx`,
   `add-to-circle-button.tsx`) — highest-traffic surfaces, worth getting
   right first.
2. Admin forms (8 files) — internal-only, lower risk, good place to work
   out any pattern issues before touching therapist-facing surfaces again.
3. Remaining app/* forms (7 files) — circles, communities, feedback,
   referral detail/outcome.

**Verification before considering a batch done:**
- `npx eslint <changed files>` clean.
- `npx tsc --noEmit` clean (needs a `next build` first if `.next/types`
  doesn't exist yet — Next.js 16 generates route types from a build).
- Visual check via `wrangler dev` (not `next dev` — this repo's
  `next dev` has a known-flaky async Hyperdrive-init race; `wrangler dev`
  doesn't have this problem). Start it, hit the changed pages, confirm no
  regressions. See `HANDOFF_VSCODE.md` for the full local setup if this
  hasn't been done in this environment yet.
- Full `vitest` suite stays green (`DATABASE_URL=postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev
  npx vitest run`) — this project's tests run against real Postgres, no
  mocks.

**When done (or handing back mid-task):** update the "Right now" section
above — what's done, what's left, which files if partial. Commit and push
to `main` before switching tools, per the existing git discipline
(`HANDOFF_VSCODE.md` §3) — never both tools mid-edit on the same branch at
once.
