# AHP Network

The Verified Professional Network for Allied Health Professionals — see `CLAUDE.md` for the project context, stack, and non-negotiable rules, and `BUILD_SEQUENCE.md` for the phase-by-phase build order this app follows.

## Stack

Next.js on Cloudflare Workers via the OpenNext adapter, Supabase Postgres behind Cloudflare Hyperdrive, Drizzle ORM, Tailwind CSS + shadcn/ui, Cloudflare R2. Full rationale for each choice is in `CLAUDE.md`'s stack table.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # point at a local Postgres — see the file's comments
```

`next dev`/`next build` need a local Postgres to emulate the Hyperdrive binding — `.dev.vars.example` explains the exact variable.

**One-time setup on a fresh local Postgres:** `users.id` carries a foreign key to Supabase Auth's `auth.users(id)` (see `drizzle/0002_identity_core.sql`) — a bare local Postgres instance has no `auth` schema, since that's Supabase-provisioned infrastructure our migrations don't create. Before running migrations, stub it:

```sql
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);
```

CI does the same thing (see `.github/workflows/ci.yml`) against its own throwaway Postgres container. Then:

```bash
npx drizzle-kit migrate   # see Database, below
npm run dev
```

## Database

Migrations are Drizzle-generated (tables) or hand-written (extensions, PL/pgSQL functions, views, role grants — tracked in the same `drizzle/` journal). Always `drizzle-kit migrate`, never `push`:

```bash
npx drizzle-kit generate   # after changing src/db/schema.ts
npx drizzle-kit migrate    # apply
```

## Testing

```bash
npm test        # Vitest — DB-touching tests run against a real local Postgres, never mocks
npm run lint
npm run typecheck
```

## Deploying

```bash
npm run deploy           # production
npm run deploy:staging   # staging — a distinct Worker, see wrangler.jsonc's env.staging
```
