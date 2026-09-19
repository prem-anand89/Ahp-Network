# VS Code Handoff — AHP Network

Written 2026-09-19, for continuing this build locally in VS Code with Claude Code
and Antigravity (Gemini) instead of Claude Code on the web. Read this once when
you open the repo locally; it's the bridge between the web session's context and
whatever tool picks this up next.

## 1. Where the build actually stands

Phases 0 through 8 of `BUILD_SEQUENCE.md` are built, plus the H3 pull-forward
(Circles + full Communities), the referral outcome loop (accept → completed/
auto_closed, nudges, backstop close), and circle-targeted referrals. Production
is live on Cloudflare Workers + Supabase (Mumbai project, `fuvfeqjteehgasfsxfzq`),
deployed via `.github/workflows/deploy.yml` on every push to `main`.

**Genuinely pending — pick from here, not from BUILD_SEQUENCE.md's original order:**

1. **Legal doc placeholders — do this first, it's not code.** `FOUNDING_MEMBER_DECLARATION.md`
   and `INTERIM_PRIVACY_NOTICE.md` don't exist in the repo yet (referenced by
   `BUILD_SEQUENCE.md` and `ARCHITECTURE_REVIEW.md` §F but never created). They need
   the founder's actual email/phone/date filled in. This is the one thing blocking
   onboarding a real person — nothing else in the backlog blocks that.
2. **shadcn/ui component library is thin.** `src/components/ui/` has only
   `button.tsx`. Every form (`post-referral-form.tsx`, `onboarding-flow.tsx`,
   the credential upload form) uses raw `<input>`/`<select>` with hand-written
   Tailwind classes instead of shadcn `Input`/`Select`/`Textarea`/`Label`. The
   token layer in `src/app/globals.css` is solid (G9 accent decision, dark mode,
   the badge shape+icon+text constraint) — it's the component layer that's
   incomplete. Fix: `npx shadcn@latest add input select label textarea dialog card`,
   then migrate the existing forms over one at a time.
3. **Phase 6.5 — Railway warm-standby deploy.** Never done; no trace of it in the
   repo. The plan calls this "one session, do not skip" once the referral engine
   is stable, as the documented fallback if a hosting trigger in CLAUDE.md ever
   fires. It's stable now, so this is overdue, not deferred-by-design.

**Correctly not built** (don't add these): Metabase (deferred per CLAUDE.md until
ops load justifies it), community-targeted referrals, document attachments,
two-way messaging, structured clinical fields, push/email outcome prompts,
private circle notes, mutual connections — all deliberately out of scope, listed
with reasoning in the earlier execution plan's "Deferred" section.

## 2. Setup

```
git clone <repo>
cd Ahp-Network
npm ci --legacy-peer-deps
```

- Install the **Claude Code** VS Code extension. It reads `CLAUDE.md` automatically
  every session — that's what's been enforcing every rule below throughout this
  build.
- Install **Antigravity** (or whatever Gemini-based tool) separately. **It will
  not read `CLAUDE.md` on its own.** Paste the "Ground rules" section below into
  its context at the start of every session it touches this repo, or point it at
  the file directly and ask it to read it first.
- Local dev loop: `next dev` for fast iteration. Before calling anything done,
  also run it through `wrangler dev` — Workers is a genuinely different runtime
  than Node, and this project has been bitten by that gap before (the per-request
  DB client bug in `src/db/db-per-request-client.test.ts` is the canonical
  example of something that only broke in `wrangler dev`/production).
- **Never run `wrangler deploy` or `drizzle-kit migrate` against production from
  a laptop.** The only path to production is `git push` to `main`, which triggers
  `.github/workflows/deploy.yml`. That workflow applies migrations (via
  `PROD_DB_URL`, now fixed and using the session-pooler connection string) and
  then deploys the Worker, in that order, every time. Keep it that way — it's
  the one audited path, and duplicating it locally reintroduces exactly the kind
  of silent drift this project has spent real effort eliminating.

## 3. Division of labor

**`HANDOFF.md` (repo root) is the live baton between tools — read it
first, every session, update it last, before stopping.** This file
(`HANDOFF_VSCODE.md`) is a one-time bridge doc, written once and rarely
touched again; `HANDOFF.md` is where "what's in progress, what's done,
whose turn is it" actually lives and changes constantly.

- **Claude Code**: anything touching the referral engine, migrations, authz
  (`src/lib/authz.ts`), retention/purge logic, or the three locked PL/pgSQL
  transactions (`shortlist_referral`, `accept_referral`, `lapse_offers`). These
  are the places where CLAUDE.md's non-negotiable rules matter most and where a
  wrong move is expensive.
- **Antigravity/Gemini**: large-context, read-heavy, or visual work — a full-tree
  accessibility sweep, prototyping a screen's layout in isolation before it's
  wired to real data, or driving the shadcn component migration above (its
  screenshot-iteration loop is a good fit for that specifically).
- **Never both mid-edit on the same branch at once.** Commit between
  switching tools, same discipline as switching between two human developers.
- **Antigravity (or any tool other than Claude Code) never pushes to `main`
  directly.** Commit locally, or push to a feature branch, and hand back via
  `HANDOFF.md` — Claude Code reviews the diff, runs the pre-push checks
  (§5), and does the actual push to `main`. This isn't a trust judgment on
  Antigravity's work quality; it's that a `main` push is a production
  deploy trigger (`.github/workflows/deploy.yml`), and a second pair of
  eyes on the diff before that specific action is cheap insurance — it
  caught a real bug once already (`HANDOFF.md`'s directory-page finding:
  a Radix Select constraint plus a swap that contradicted that page's own
  documented no-client-JS design, both invisible to a content-following
  read of the task brief, only visible in the actual diff).

## 4. Ground rules to give Antigravity/Gemini every session

Paste this in, or point it at `CLAUDE.md` directly and ask it to read the whole
file before making any change:

> This is TheraNet Technologies' AHP Network — a verified professional network
> for physiotherapists/OTs/SLPs in India. Before editing anything, read
> `/CLAUDE.md` in full. It contains non-negotiable architecture rules from a
> real incident history — among them: R2 access must use the S3-compatible API,
> never Cloudflare's native binding API; `status`/state columns are `TEXT + CHECK`,
> never Postgres `ENUM`; the three referral transactions
> (`shortlist_referral`/`accept_referral`/`lapse_offers`) are single-statement
> PL/pgSQL calls and must never be reimplemented as client-side sequential
> queries or a wrapped `db.transaction()`; there is no ranking/scoring/star
> language anywhere in the product, ever; credentials are never auto-approved
> regardless of OCR confidence; the Postgres client in `src/db/db.ts` is built
> per-request and never cached across requests. Treat every rule in that file
> as binding, not advisory, even if it looks like it's slowing you down.

## 5. Git discipline (unchanged from the web session)

- Feature branch per task, PR into `main`, same as this project's existing
  convention (see recent PR history for the commit-message style).
- Before pushing: `npx tsc --noEmit`, `npx eslint src`, `DATABASE_URL=... npx
  vitest run` all clean. This project's tests run against real Postgres, never
  mocks, for anything touching the database — don't let either tool skip that.
- Never rewrite history on a shared branch; never force-push to `main`.
- If a migration is involved, generate it with `drizzle-kit generate` (schema
  changes) or hand-write it (multi-clause CHECKs, functions, grants) per the
  existing convention in `drizzle/` — never `drizzle-kit push`.
