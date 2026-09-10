// A temporary diagnostic for the /app/* navigation latency, added after
// PR #20's fixes (local JWT verification + parallelised queries) moved the
// real numbers from India almost not at all: dashboard 4.98-5.06s against a
// 5.73s baseline.
//
// What makes this worth measuring rather than reasoning about: in the same
// DevTools capture, `dashboard?_rsc=` was served once in 37ms and other
// times in ~5s. The SAME route. A constant per-navigation cost — an auth
// round trip, N sequential queries to Sydney, connection setup — cannot
// produce a 37ms sample. So whatever costs five seconds is intermittent,
// and every theory so far has assumed it was constant. Two rounds of fixes
// were already spent on a mis-modelled cause; this one gets measured.
//
// The isolate fields below are the point. Cloudflare gives each Worker
// isolate a fresh module scope, so BOOT_AT/SERVED are per-isolate: a
// request landing on a cold isolate reports servedByThisIsolate: 1 and a
// tiny isolateAgeMs, while a warm one reports higher counts. If the slow
// requests are the cold ones, the cost is isolate startup (bundle parse +
// module init) and no amount of query tuning touches it. If cold and warm
// are equally slow, it is the phases below — and they say which.
//
// Gated on a signed-in session and returns timings only, never data. Delete
// once the cause is identified; it is a probe, not a feature.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { getVerifiedUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Module scope = isolate scope on Workers. A new isolate resets both.
const BOOT_AT = Date.now();
let SERVED = 0;

/** ms elapsed since `from`, rounded to 0.1ms. */
function since(from: number): number {
  return Math.round((performance.now() - from) * 10) / 10;
}

export async function GET() {
  const requestStart = performance.now();
  const servedByThisIsolate = ++SERVED;
  const isolateAgeMs = Date.now() - BOOT_AT;

  // Phase 1 — local JWT verification (PR #20). Should be single-digit ms
  // once the JWKS is cached in this isolate; a first-in-isolate call pays
  // one fetch of /.well-known/jwks.json. Doubles as the auth gate.
  const claimsStart = performance.now();
  const userId = await getVerifiedUserId();
  const claimsMs = since(claimsStart);

  if (!userId) {
    // Indistinguishable from a route that does not exist, so this reveals
    // nothing to an unauthenticated caller.
    return new NextResponse(null, { status: 404 });
  }

  // Phase 2 — building the per-request postgres client (never cached across
  // requests; see db.ts). Hyperdrive pools the origin connections, so this
  // should be cheap; if it is not, that assumption is wrong.
  const dbStart = performance.now();
  const db = await getDb();
  const dbClientMs = since(dbStart);

  // Phase 3 — first round trip. Carries whatever connection setup Hyperdrive
  // did not absorb, so it is normally the largest single number here.
  const ping1Start = performance.now();
  await db.$client`SELECT 1`;
  const firstQueryMs = since(ping1Start);

  // Phase 4 — second round trip on the same client, which is the marginal
  // cost of one more query. firstQueryMs minus this is roughly the setup
  // cost hiding inside the first one.
  const ping2Start = performance.now();
  await db.$client`SELECT 1`;
  const secondQueryMs = since(ping2Start);

  // Phase 5 — a real indexed lookup, for comparison against a bare ping.
  const rowStart = performance.now();
  await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId));
  const userRowMs = since(rowStart);

  const totalMs = since(requestStart);

  const body = {
    isolate: {
      servedByThisIsolate,
      isolateAgeMs,
      // The tell: a cold isolate is request 1 at an age of roughly this
      // request's own duration.
      likelyColdStart: servedByThisIsolate === 1,
    },
    phases: { claimsMs, dbClientMs, firstQueryMs, secondQueryMs, userRowMs },
    totalMs,
  };

  return NextResponse.json(body, {
    headers: {
      // Renders as a breakdown in DevTools' Timing tab, so repeated
      // navigations can be read without opening each response body.
      "server-timing": [
        `claims;dur=${claimsMs}`,
        `dbclient;dur=${dbClientMs}`,
        `q1;dur=${firstQueryMs}`,
        `q2;dur=${secondQueryMs}`,
        `userrow;dur=${userRowMs}`,
        `total;dur=${totalMs}`,
      ].join(", "),
      "cache-control": "no-store",
    },
  });
}
