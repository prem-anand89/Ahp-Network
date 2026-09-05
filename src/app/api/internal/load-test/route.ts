// Phase 12's hard gate — see src/lib/load-test.ts for why this exists and
// what it proves. Inert by default and safe to ship to every environment:
// this route always 401s unless a LOAD_TEST_SECRET Workers Secret is
// actually set, and that secret should ONLY ever be set on the staging
// Worker (`ahp-network-staging`), never on production. If it's ever set
// on production by mistake, the real risk is limited to fake
// @loadtest.internal rows appearing in production tables — visible,
// obviously fake, and removable via ?action=teardown — never real user
// data being touched, since every query here is scoped to that email
// domain or to freshly-created rows.
//
// Usage (see the guide for the full walkthrough):
//   POST /api/internal/load-test?action=accept-race&iterations=6
//   POST /api/internal/load-test?action=pool-load&n=10
//   POST /api/internal/load-test?action=teardown
//
// Actions: accept-race, shortlist-cap, lapse-vs-accept, idempotency,
// pool-load, run-all (everything except pool-load, which is run
// separately so a failure there doesn't obscure the others), teardown.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/db";
import {
  runAcceptRaceTest,
  runIdempotencyTest,
  runLapseVsAcceptTest,
  runPoolLoadTest,
  runShortlistCapTest,
  teardownLoadTestData,
  type LoadTestCheck,
} from "@/lib/load-test";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secret = (env as unknown as { LOAD_TEST_SECRET?: string }).LOAD_TEST_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const iterations = Number(url.searchParams.get("iterations") ?? "6");
  const n = Number(url.searchParams.get("n") ?? "10");

  const db = await getDb();

  if (action === "teardown") {
    const result = await teardownLoadTestData(db);
    return NextResponse.json(result);
  }

  if (action === "accept-race") {
    const r = await runAcceptRaceTest(db, iterations);
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  }
  if (action === "shortlist-cap") {
    const r = await runShortlistCapTest(db, iterations);
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  }
  if (action === "lapse-vs-accept") {
    const r = await runLapseVsAcceptTest(db, iterations);
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  }
  if (action === "idempotency") {
    const r = await runIdempotencyTest(db, iterations);
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  }
  if (action === "pool-load") {
    const r = await runPoolLoadTest(db, n);
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  }
  if (action === "run-all") {
    const checks: LoadTestCheck[] = [
      await runAcceptRaceTest(db, iterations),
      await runShortlistCapTest(db, iterations),
      await runLapseVsAcceptTest(db, iterations),
      await runIdempotencyTest(db, iterations),
    ];
    const allOk = checks.every((c) => c.ok);
    return NextResponse.json(
      { summary: allOk ? "ALL PASS — call ?action=pool-load&n=20 next" : "FAILURES — see checks", checks },
      { status: allOk ? 200 : 500 },
    );
  }

  return NextResponse.json(
    { error: "unknown action", actions: ["accept-race", "shortlist-cap", "lapse-vs-accept", "idempotency", "pool-load", "run-all", "teardown"] },
    { status: 400 },
  );
}
