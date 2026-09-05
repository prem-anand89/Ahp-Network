// Smoke-tests the Phase 12 load-test harness itself against local
// Postgres before anyone runs it against staging — same real call sites
// (shortlistCandidatesTx/acceptOfferTx/lapse_offers) as production, just
// not over an actual Hyperdrive-fronted network hop.

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  runAcceptRaceTest,
  runIdempotencyTest,
  runLapseVsAcceptTest,
  runPoolLoadTest,
  runShortlistCapTest,
  teardownLoadTestData,
} from "./load-test";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 20 });
const db = drizzle(client, { schema });

afterAll(async () => {
  await teardownLoadTestData(db);
  await client.end();
});

describe("load-test harness (Phase 12 staging gate, smoke-tested locally)", () => {
  it("accept-race: exactly one winner, no dangling shortlists", async () => {
    const result = await runAcceptRaceTest(db, 3);
    expect(result.ok).toBe(true);
  });

  it("shortlist-cap: never exceeds 2 shortlisted interests under a concurrent race", async () => {
    const result = await runShortlistCapTest(db, 3);
    expect(result.ok).toBe(true);
  });

  it("lapse-vs-accept: never both succeed", async () => {
    const result = await runLapseVsAcceptTest(db, 3);
    expect(result.ok).toBe(true);
  });

  it("idempotency: a repeated accept with the same key produces one accept, not two", async () => {
    const result = await runIdempotencyTest(db, 3);
    expect(result.ok).toBe(true);
  });

  it("pool-load: many concurrent referrals, no pool exhaustion, no duplicate accepts", async () => {
    const result = await runPoolLoadTest(db, 6);
    expect(result.ok).toBe(true);
  });

  it("teardown removes every loadtest.internal row it created", async () => {
    await runAcceptRaceTest(db, 1);
    const before = await client`SELECT count(*)::int AS n FROM users WHERE email LIKE '%@loadtest.internal'`;
    expect(before[0].n).toBeGreaterThan(0);

    await teardownLoadTestData(db);

    const after = await client`SELECT count(*)::int AS n FROM users WHERE email LIKE '%@loadtest.internal'`;
    expect(after[0].n).toBe(0);
  });
});
