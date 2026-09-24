// Round 3 — loadIndiaPostAreasTx against real local Postgres, never mocks
// (BUILD_SEQUENCE.md Phase 0's test-stack convention). Uses clearly-test-
// only state/city/taluk/locality names with a random suffix, never real
// India Post data, so this can never collide with a real load or with
// another test file's rows in this shared dev database.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { groupIndiaPostRows, loadIndiaPostAreasTx, type GroupedLocality } from "./india-post-loader";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

// Deleted in this order every time — localities and zones reference
// cities via city_area_id (FK RESTRICT), and cities reference states via
// parent_id (FK RESTRICT), so children must go first.
afterEach(async () => {
  await client`DELETE FROM areas WHERE area_level = 'locality' AND source = 'india_post' AND name ILIKE 'Test %'`;
  await client`DELETE FROM areas WHERE area_level = 'zone' AND source = 'india_post' AND name ILIKE 'Test %'`;
  await client`DELETE FROM areas WHERE area_level = 'city' AND source = 'india_post' AND name ILIKE 'Test %'`;
  await client`DELETE FROM areas WHERE area_level = 'state' AND source = 'india_post' AND name ILIKE 'Test %'`;
});

afterAll(async () => {
  await client.end();
});

function fixture(suffix: string): GroupedLocality[] {
  return groupIndiaPostRows([
    {
      officeName: `Test Locality Alpha ${suffix} S.O`,
      taluk: `Test Taluk Alpha ${suffix}`,
      districtName: `Test City Alpha ${suffix}`,
      stateName: `Test State Alpha ${suffix}`,
      pincode: "500001",
    },
    {
      officeName: `Test Locality Beta ${suffix} B.O`,
      taluk: `Test Taluk Alpha ${suffix}`,
      districtName: `Test City Alpha ${suffix}`,
      stateName: `Test State Alpha ${suffix}`,
      pincode: "500002",
    },
  ]);
}

describe("loadIndiaPostAreasTx", () => {
  it("creates the full state -> city -> zone -> locality chain with correct parent/ancestor links", async () => {
    const suffix = crypto.randomUUID();
    const result = await loadIndiaPostAreasTx(db, fixture(suffix));

    expect(result).toEqual({ statesCreated: 1, citiesCreated: 1, zonesCreated: 1, localitiesCreated: 2 });

    const [state] = await client`SELECT * FROM areas WHERE area_level = 'state' AND name ILIKE ${"Test State Alpha " + suffix}`;
    const [city] = await client`SELECT * FROM areas WHERE area_level = 'city' AND name ILIKE ${"Test City Alpha " + suffix}`;
    const [zone] = await client`SELECT * FROM areas WHERE area_level = 'zone' AND name ILIKE ${"Test Taluk Alpha " + suffix}`;
    const localities = await client`SELECT * FROM areas WHERE area_level = 'locality' AND name ILIKE ${"Test Locality % " + suffix}`;

    expect(state).toBeTruthy();
    expect(city.parent_id).toBe(state.id);
    expect(city.city_area_id).toBe(city.id);
    expect(city.ancestor_ids).toEqual([state.id]);

    expect(zone.parent_id).toBe(city.id);
    expect(zone.city_area_id).toBe(city.id);
    expect(zone.ancestor_ids).toEqual([state.id, city.id]);

    expect(localities).toHaveLength(2);
    for (const loc of localities) {
      expect(loc.parent_id).toBe(zone.id);
      expect(loc.city_area_id).toBe(city.id);
      expect(loc.ancestor_ids).toEqual([state.id, city.id, zone.id]);
      expect(loc.source).toBe("india_post");
      expect(loc.curation_status).toBe("approved");
    }
    expect(localities.map((l) => l.pincode).sort()).toEqual(["500001", "500002"]);
  });

  it("is idempotent: a second run over the same rows creates nothing", async () => {
    const suffix = crypto.randomUUID();
    const rows = fixture(suffix);
    await loadIndiaPostAreasTx(db, rows);

    const second = await loadIndiaPostAreasTx(db, rows);
    expect(second).toEqual({ statesCreated: 0, citiesCreated: 0, zonesCreated: 0, localitiesCreated: 0 });
  });

  it("gives two different states' same-named district a disambiguated, non-colliding slug", async () => {
    const suffix = crypto.randomUUID();
    const rows = groupIndiaPostRows([
      {
        officeName: `Test Shared District Office ${suffix} S.O`,
        taluk: `Test Taluk One ${suffix}`,
        districtName: `Test Shared District ${suffix}`,
        stateName: `Test State One ${suffix}`,
        pincode: "600001",
      },
      {
        officeName: `Test Shared District Office ${suffix} S.O`,
        taluk: `Test Taluk Two ${suffix}`,
        districtName: `Test Shared District ${suffix}`,
        stateName: `Test State Two ${suffix}`,
        pincode: "700001",
      },
    ]);

    const result = await loadIndiaPostAreasTx(db, rows);
    expect(result.citiesCreated).toBe(2);

    const cities = await client`SELECT slug, parent_id FROM areas WHERE area_level = 'city' AND name ILIKE ${"Test Shared District " + suffix}`;
    expect(cities).toHaveLength(2);
    expect(new Set(cities.map((c) => c.slug)).size).toBe(2); // distinct slugs, no collision

    // No extra cleanup needed here — every name this test creates starts
    // with "Test ", which the shared afterEach's ILIKE pattern already covers.
  });
});
