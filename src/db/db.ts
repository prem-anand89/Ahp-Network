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
//
// Client cache vs idle_timeout: postgres.js closes idle sockets after
// `idle_timeout` seconds. Reusing a drizzle wrapper past that makes the
// next query hang until the Worker aborts the RSC stream — the client then
// throws React #412 ("Connection closed") and /app/* nav shows the error
// boundary until a full reload. Cache TTL must stay below idle_timeout.
// Hyperdrive already pools origin connections, so max: 1 per isolate.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

interface CachedDb {
  db: Db;
  sql: Sql;
  createdAt: number;
}

let cached: CachedDb | undefined;
// Guards the window between the `cached` check and its assignment — without
// this, two requests landing in the same isolate before the first call's
// `await getCloudflareContext(...)` resolves would each build a separate
// connection pool, leaking one under exactly the burst-traffic conditions
// most likely to strain Hyperdrive's query budget.
let inFlight: Promise<Db> | undefined;

/** Must stay below postgres.js `idle_timeout` (20s) so we never hand back a client whose sockets are already closed. */
export const DB_CLIENT_MAX_CACHE_MS = 15_000;

export function isDbClientReusable(createdAt: number, now = Date.now()): boolean {
  return now - createdAt < DB_CLIENT_MAX_CACHE_MS;
}

function discardCached(): CachedDb | undefined {
  const previous = cached;
  cached = undefined;
  return previous;
}

function endQuietly(sql: Sql): void {
  void sql.end({ timeout: 2 }).catch(() => {
    // Isolate is recycling the client — a failed end is not actionable.
  });
}

export async function getDb(): Promise<Db> {
  if (cached && isDbClientReusable(cached.createdAt)) {
    return cached.db;
  }

  if (inFlight) return inFlight;

  const stale = discardCached();

  inFlight = (async () => {
    const { env } = await getCloudflareContext({ async: true });
    const sql = postgres(env.HYPERDRIVE.connectionString, {
      prepare: false,
      fetch_types: false,
      max: 1,
      connect_timeout: 10,
      idle_timeout: 20,
    });

    const db = drizzle(sql, { schema });
    cached = { db, sql, createdAt: Date.now() };
    if (stale) endQuietly(stale.sql);
    return db;
  })();

  try {
    return await inFlight;
  } catch (error) {
    const failed = discardCached();
    if (failed) endQuietly(failed.sql);
    if (stale && stale !== failed) endQuietly(stale.sql);
    throw error;
  } finally {
    inFlight = undefined;
  }
}
