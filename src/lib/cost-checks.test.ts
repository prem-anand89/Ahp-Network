// Phase 12 cost-trigger checks — runs against a real local Postgres.

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { checkCostTriggers } from "./cost-checks";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

afterAll(async () => {
  await client.end();
});

describe("checkCostTriggers", () => {
  it("returns real connection and database-size figures, healthy under normal test load", async () => {
    const result = await checkCostTriggers(db);
    expect(result.maxConnections).toBeGreaterThan(0);
    expect(result.activeConnections).toBeGreaterThan(0);
    expect(result.connectionUtilization).toBeGreaterThan(0);
    expect(result.connectionUtilization).toBeLessThan(0.7);
    expect(result.databaseSizeBytes).toBeGreaterThan(0);
    expect(result.healthy).toBe(true);
    expect(result.alerts).toEqual([]);
  });

  // The test above only exercises the healthy path — real connection counts
  // under normal test load are nowhere near 70%. Phase 12 asks that the
  // alert is "confirmed firing correctly at their thresholds," which the
  // healthy path can't demonstrate on its own: a threshold check with only
  // its non-firing branch ever exercised is unverified in the one way that
  // matters. A fake $client stands in for postgres.js's tagged-template
  // client so the three queries can return chosen figures without actually
  // opening enough connections to cross 70% for real.
  it("alerts when connection utilization crosses the 70% threshold", async () => {
    const responses = [
      [{ active_connections: 71 }],
      [{ max_connections: 100 }],
      [{ database_size: "123456" }],
    ];
    let call = 0;
    const fakeClient = (() => {
      return Promise.resolve(responses[call++]);
    }) as unknown as typeof db.$client;
    const fakeDb = { $client: fakeClient } as unknown as typeof db;

    const result = await checkCostTriggers(fakeDb);

    expect(result.healthy).toBe(false);
    expect(result.connectionUtilization).toBeCloseTo(0.71);
    expect(result.alerts).toEqual([
      {
        check: "supabase_connection_utilization",
        message: expect.stringContaining("71.0%"),
      },
    ]);
  });

  it("stays healthy exactly at the threshold boundary (not above it)", async () => {
    const responses = [
      [{ active_connections: 70 }],
      [{ max_connections: 100 }],
      [{ database_size: "123456" }],
    ];
    let call = 0;
    const fakeClient = (() => {
      return Promise.resolve(responses[call++]);
    }) as unknown as typeof db.$client;
    const fakeDb = { $client: fakeClient } as unknown as typeof db;

    const result = await checkCostTriggers(fakeDb);

    expect(result.connectionUtilization).toBeCloseTo(0.7);
    expect(result.healthy).toBe(true);
    expect(result.alerts).toEqual([]);
  });
});
