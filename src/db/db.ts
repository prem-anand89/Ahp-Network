// THE single database connection file. Per CLAUDE.md's non-negotiable: all
// connection setup lives here, never inlined or duplicated elsewhere in the
// codebase — every query in the app, including the referral transactions,
// goes through Hyperdrive via this one client.
//
// prepare: false — named prepared statements don't survive Hyperdrive's own
// pooled connections being handed to different backends between statements.
// See spike/README.md for the full story, including the real infrastructure
// bug found in Phase 0.5: Hyperdrive's origin must be Supabase's
// SESSION-mode pooler (port 5432), never transaction-mode (6543) — stacking
// two transaction-mode poolers causes every connection attempt to fail
// regardless of load. That origin choice lives in wrangler.jsonc's
// `hyperdrive` binding config, not here, but this file is where it would
// bite if gotten wrong.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

interface CachedDb {
  db: Db;
  client: postgres.Sql;
  createdAt: number;
}

let cached: CachedDb | undefined;
// Guards the window between the `cached` check and its assignment — without
// this, two requests landing in the same isolate before the first call's
// `await getCloudflareContext(...)` resolves would each build a separate
// connection pool, leaking one under exactly the burst-traffic conditions
// most likely to strain Hyperdrive's query budget.
let inFlight: Promise<Db> | undefined;

// Workers isolates are long-lived; a module-level postgres client whose TCP
// connection has gone idle can make every subsequent soft-nav RSC fetch fail
// until a full reload hits a fresh isolate. Recreate the client periodically.
const MAX_CACHE_MS = 60_000;

export async function getDb(): Promise<Db> {
  if (cached && Date.now() - cached.createdAt < MAX_CACHE_MS) {
    return cached.db;
  }

  const stale = cached;
  cached = undefined;

  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { env } = await getCloudflareContext({ async: true });
    const client = postgres(env.HYPERDRIVE.connectionString, {
      prepare: false,
      // The production Hyperdrive config caps origin_connection_limit at
      // 20 total connections to Postgres, shared across every Worker
      // isolate. At `max: 8` per isolate, as few as 3 concurrent isolates
      // (easy under Workers' lack of isolate reuse, or the 60s cache-swap
      // window briefly doubling this pool's own count) exhaust that
      // ceiling — every request past it queues for a slot or times out,
      // which is what "slow, sometimes fails" looked like. Kept well
      // under a fifth of the origin limit so several isolates can run
      // concurrently without contention.
      max: 3,
      connect_timeout: 10,
      idle_timeout: 20,
    });

    const db = drizzle(client, { schema });
    cached = { db, client, createdAt: Date.now() };

    // The previous pool's connections were never released before this fix —
    // every 60s TTL expiry leaked up to `max` connections per isolate, with
    // nothing ever calling .end() on the old client. Since nearly every
    // route calls getDb(), the leak eventually exhausted Hyperdrive's/
    // Postgres's connection budget across the whole app, not just one page.
    // Closed here (not awaited) so the graceful-shutdown wait never adds to
    // this request's latency.
    if (stale) {
      stale.client.end({ timeout: 5 }).catch(() => {});
    }

    return db;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = undefined;
  }
}
