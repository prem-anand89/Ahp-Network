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
// Client cache TTL vs idle_timeout: postgres.js closes a connection's
// socket after `idle_timeout` seconds of inactivity. A previous version of
// this file cached the client for 60s while idle_timeout stayed at 20s —
// for up to 40 seconds, getDb() could hand back a client whose socket was
// already closed, and the next query on it hung until the Worker aborted
// the RSC stream, surfacing to the browser as React error #412
// ("Connection closed") on completely ordinary navigation, not just fast
// clicking. DB_CLIENT_MAX_CACHE_MS must stay below idle_timeout — enforced
// by db-cache.test.ts, not just this comment.

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

const IDLE_TIMEOUT_SECONDS = 20;
/** Must stay below postgres.js's own idle_timeout so a cached client is
 * never handed back after its socket has already been closed underneath it. */
export const DB_CLIENT_MAX_CACHE_MS = 15_000;

export function isDbClientReusable(createdAt: number, now = Date.now()): boolean {
  return now - createdAt < DB_CLIENT_MAX_CACHE_MS;
}

// Reading `cached` through a function call, rather than inline, stops
// TypeScript's control-flow analysis from narrowing it to `undefined`
// based on the synchronous `cached = undefined` a few lines above the
// async IIFE that later reassigns it — the analysis can't see that the
// closure runs (and reassigns `cached`) before the `await` below resolves.
function readCached(): CachedDb | undefined {
  return cached;
}

function endQuietly(sql: Sql): void {
  // Not awaited — a graceful-shutdown wait on the outgoing client must
  // never add latency to the request that triggered the swap.
  void sql.end({ timeout: 2 }).catch(() => {});
}

export async function getDb(): Promise<Db> {
  if (cached && isDbClientReusable(cached.createdAt)) {
    return cached.db;
  }

  const stale = cached;
  cached = undefined;

  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { env } = await getCloudflareContext({ async: true });
    const sql = postgres(env.HYPERDRIVE.connectionString, {
      prepare: false,
      // fetch_types: false — skip postgres.js's automatic OID/type
      // introspection query on first connect; this app never uses
      // non-standard types that would need it, and it's one fewer round
      // trip on every fresh client.
      fetch_types: false,
      // The production Hyperdrive config caps origin_connection_limit at
      // 20 total connections to Postgres, shared across every Worker
      // isolate. Hyperdrive already pools the actual origin connections
      // itself, so this client only needs one logical connection per
      // isolate rather than maintaining a separate multi-connection pool
      // in addition to it.
      max: 1,
      connect_timeout: 10,
      idle_timeout: IDLE_TIMEOUT_SECONDS,
    });

    const db = drizzle(sql, { schema });
    cached = { db, sql, createdAt: Date.now() };
    if (stale) endQuietly(stale.sql);
    return db;
  })();

  try {
    return await inFlight;
  } catch (error) {
    // A failed connection attempt must not leave `cached` pointing at a
    // half-built client, and the stale client this attempt was meant to
    // replace still needs closing rather than leaking.
    const failed = readCached();
    cached = undefined;
    if (failed) endQuietly(failed.sql);
    if (stale && stale !== failed) endQuietly(stale.sql);
    throw error;
  } finally {
    inFlight = undefined;
  }
}
