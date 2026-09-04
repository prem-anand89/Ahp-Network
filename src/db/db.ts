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

let cached: Db | undefined;
// Guards the window between the `cached` check and its assignment — without
// this, two requests landing in the same isolate before the first call's
// `await getCloudflareContext(...)` resolves would each build a separate
// connection pool, leaking one under exactly the burst-traffic conditions
// most likely to strain Hyperdrive's query budget.
let inFlight: Promise<Db> | undefined;

export async function getDb(): Promise<Db> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { env } = await getCloudflareContext({ async: true });
    const client = postgres(env.HYPERDRIVE.connectionString, {
      prepare: false,
      max: 8,
      connect_timeout: 10,
      idle_timeout: 20,
    });

    cached = drizzle(client, { schema });
    return cached;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = undefined;
  }
}
