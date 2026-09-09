// THE single database connection file. Per CLAUDE.md's non-negotiable: all
// connection setup lives here, never inlined or duplicated elsewhere in the
// codebase — every query in the app, including the referral transactions,
// goes through Hyperdrive via this one client.
//
// ─────────────────────────────────────────────────────────────────────────
// NEVER cache this client across requests. This is not a tuning knob.
// ─────────────────────────────────────────────────────────────────────────
//
// A postgres.js client owns TCP sockets, and Cloudflare Workers ties every
// I/O object to the request that created it. Hand a client from request A to
// request B and its sockets are already torn down — the query then hangs
// forever rather than throwing, until the runtime kills the request with
// "The Workers runtime canceled this request because it detected that your
// Worker's code had hung and would never generate a response." The aborted
// response reaches the browser as React error #412 ("Connection closed") and
// Cloudflare logs it as Error 1101.
//
// That was a real production bug on /app/*: an earlier version of this file
// kept the client in a module-level variable with a TTL. Reproduced under
// `wrangler dev` by requesting one dynamic page repeatedly — request 1
// returned 200 (it created the client), requests 2-8 all 500'd (they reused
// it). Shortening the TTL does not help and is not a partial fix: any reuse
// at all, however brief, is a reuse across requests. Two rounds of fixes
// were spent tuning that TTL before the actual rule surfaced.
//
// Cloudflare's Hyperdrive troubleshooting guide states the rule directly:
// "These errors occur when a database client or connection is created in the
// global scope or is reused across requests... Always create database clients
// inside your handlers." Connection setup cost is exactly what Hyperdrive
// already pools away, so a per-request client is the intended design, not a
// concession.
//
// prepare: false — named prepared statements don't survive Hyperdrive's own
// pooled connections being handed to different backends between statements.
// See spike/README.md for the full story, including the other infrastructure
// bug found in Phase 0.5: Hyperdrive's origin must be Supabase's SESSION-mode
// pooler (port 5432), never transaction-mode (6543). That origin choice lives
// in wrangler.jsonc's `hyperdrive` binding config, not here.

import { cache } from "react";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * One Drizzle client per request.
 *
 * React's `cache()` scopes the memo to a single request, so the many
 * `getDb()` calls a single page or action makes share one client and one
 * connection — while no client is ever visible to a later request. Both
 * halves matter: without the memo a page holding several `getDb()` calls
 * would open several connections and could reach Workers' six-simultaneous-
 * connection ceiling; with a module-level cache instead, it would hit the
 * cross-request hang described above.
 *
 * The client is deliberately not closed. Workers tears the socket down with
 * the request context that owns it, and an explicit `.end()` here would have
 * to guess which query is the request's last one.
 */
export const getDb = cache(async (): Promise<Db> => {
  const { env } = await getCloudflareContext({ async: true });

  const sql = postgres(env.HYPERDRIVE.connectionString, {
    prepare: false,
    // Skip postgres.js's OID/type introspection round trip on connect; this
    // app uses no types that need it, and the client is now built per
    // request, so that round trip would otherwise be paid on every one.
    fetch_types: false,
    // Hyperdrive pools the actual origin connections. One logical connection
    // per request is all this client needs, and it keeps a request well
    // clear of Workers' six-simultaneous-open-connections limit.
    max: 1,
    connect_timeout: 10,
  });

  return drizzle(sql, { schema });
});
