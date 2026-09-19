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
- Migrated batch 1 (auth/public-facing forms) to shadcn components.
- Migrated batch 2 (admin forms: 8 files) to shadcn components.
- Migrated batch 3 (app/* forms: 7 files) to shadcn components. Committed on `main`.

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


