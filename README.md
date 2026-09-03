# AHP Network

The Verified Professional Network for Allied Health Professionals — see `CLAUDE.md` for the project context, stack, and non-negotiable rules, and `BUILD_SEQUENCE.md` for the phase-by-phase build order this app follows.

## Stack

Next.js on Cloudflare Workers via the OpenNext adapter, Supabase Postgres behind Cloudflare Hyperdrive, Drizzle ORM, Tailwind CSS + shadcn/ui, Cloudflare R2. Full rationale for each choice is in `CLAUDE.md`'s stack table.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # point at a local Postgres — see the file's comments
npm run dev
```

`next dev`/`next build` need a local Postgres to emulate the Hyperdrive binding — `.dev.vars.example` explains the exact variable.

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
