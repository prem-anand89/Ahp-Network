// Build-failing test for the rule that db.ts's header explains at length:
// the Postgres client is built per request and never cached across requests.
//
// This is not style. A postgres.js client owns TCP sockets, and Cloudflare
// Workers ties every I/O object to the request that created it. A cached
// client handed to a later request has sockets belonging to a dead context,
// and a query on it hangs forever rather than throwing — the Workers runtime
// eventually kills the request ("your Worker's code had hung and would never
// generate a response"), the RSC stream aborts mid-flight, and the browser
// reports React error #412 ("Connection closed"). Every /app/* page broke
// this way in production.
//
// The reason this needs a test rather than a comment: the failure looks like
// flakiness, so the intuitive fix is to make the cache shorter rather than to
// remove it. Two rounds of fixes were spent shortening a TTL (60s, then 15s)
// before the real rule surfaced, and both looked reasonable in review. Any
// TTL is wrong — the very next request in the same isolate reuses the client.
//
// A unit test can't observe workerd's cross-request I/O rules in jsdom, so
// this scans the source for the shapes that reintroduce the bug. The real
// end-to-end check is requesting a dynamic page repeatedly under
// `wrangler dev`: pre-fix that returned 200 once and then 500 on every
// subsequent request.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DB_SOURCE = readFileSync(join(process.cwd(), "src/db/db.ts"), "utf8");

// Strip comments so the explanatory header — which necessarily describes the
// very patterns being banned — doesn't trip the scan.
const CODE = DB_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("db.ts builds one client per request", () => {
  it("wraps getDb in React's cache() so a request shares one client", () => {
    expect(CODE).toMatch(/export\s+const\s+getDb\s*=\s*cache\(/);
  });

  it("declares no module-level mutable client cache", () => {
    // `let`/`var` at column 0 is module scope — a request-scoped client is
    // held by cache(), never by a module-level binding.
    const moduleLevelMutable = CODE.match(/^(let|var)\s+\w+/gm) ?? [];
    expect(moduleLevelMutable).toEqual([]);
  });

  it("has no cache-expiry knob, which would imply cross-request reuse", () => {
    // A TTL only has meaning if a client outlives the request that made it.
    expect(CODE).not.toMatch(/MAX_CACHE|CACHE_MS|cacheTtl|createdAt|isDbClientReusable/i);
  });
});
