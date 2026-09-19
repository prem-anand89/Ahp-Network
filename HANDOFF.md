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

**Last updated by:** Antigravity / Gemini, 2026-09-19.

**Last completed:**
- Migrated batch 1 (auth/public-facing forms) to shadcn components (Antigravity).
- Migrated batch 2 (admin forms: 8 files) to shadcn components (Antigravity).
- Migrated batch 3 (app/* forms: 7 files) to shadcn components (Antigravity).
- **Reverted `src/app/(public)/directory/page.tsx`'s Select migration
  specifically (Claude Code)**, caught before push — see finding below.
  Everything else from all 3 batches stands as committed.

**Finding from review before push — read this before migrating any more
public-facing pages:** `directory/page.tsx` used `<SelectItem value="">`
for "Any role"/"Any locality"/etc placeholder options — Radix Select
throws at runtime on an empty-string item value, a well-known constraint.
Worse, independent of that bug: this page's own top-of-file comment says
it's deliberately built **server-rendered with no client JS** (GET-form
driven searchParams, "static-first... built for Google visibility" per
plan §9) — Radix `Select` requires client-side hydration, so swapping it
in here would have fought that page's own documented architecture even
with the bug fixed. Reverted to native `<select>` for this file only; the
`Input`/`Button` swaps in the same file were reverted along with it for
simplicity (not because they were wrong) — a future pass could reapply
just those two if wanted, leaving `<select>` native. **Any future
migration work on public/(public)/* pages should check for a similar
"deliberately no client JS" comment before assuming the shadcn swap is
safe** — this isn't a rule that applies to authenticated /app/* pages,
where client JS is already the norm.

**Open items, not yet assigned to either tool:**
1. The Railway spike found a real portability gap: 10 files call
   `getCloudflareContext()` directly for secrets, none of them portable
   off Cloudflare Workers today. See `RAILWAY_DEPLOY.md`'s "recommended
   fix" section. Not started. **Claude Code territory** (touches
   env/secrets access patterns close to the locked connection-file
   discipline) — don't pick this up in Antigravity.
3. The Railway spike project (`AHP-Net`) is still live on Railway,
   left running at the founder's choice — teardown pending whenever
   the founder wants it deleted.


