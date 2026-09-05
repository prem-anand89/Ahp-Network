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
});
