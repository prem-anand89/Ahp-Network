// Round 3 — runs against real local Postgres, never mocks
// (BUILD_SEQUENCE.md Phase 0's test-stack convention). Uses its own
// clearly-test-only state/city/locality rows rather than relying on the
// real Hyderabad seed content, so this test doesn't break if that seed
// ever changes.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { searchAreas } from "./area-search";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdAreaIds: string[] = [];

afterEach(async () => {
  // Children first — locality/zone both FK-reference the city via
  // city_area_id (RESTRICT), and the city references the state via
  // parent_id (RESTRICT).
  let id: string | undefined;
  const order = [...createdAreaIds].reverse();
  createdAreaIds.length = 0;
  for (id of order) {
    await client`DELETE FROM areas WHERE id = ${id}`.catch(() => {});
  }
});

afterAll(async () => {
  await client.end();
});

async function seedTree(suffix: string) {
  const [state] = await client`
    INSERT INTO areas (name, slug, area_level, source)
    VALUES (${"Test Search State " + suffix}, ${"test-search-state-" + suffix}, 'state', 'seed_curated')
    RETURNING id`;
  createdAreaIds.push(state.id);

  const [city] = await client`
    INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, source)
    VALUES (${"Test Search City " + suffix}, ${"test-search-city-" + suffix}, 'city', ${state.id}, ${[state.id]}, 'seed_curated')
    RETURNING id`;
  await client`UPDATE areas SET city_area_id = id WHERE id = ${city.id}`;
  createdAreaIds.push(city.id);

  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, parent_id, city_area_id, ancestor_ids, pincode, source)
    VALUES (${"Test Kukatpally " + suffix}, ${"test-kukatpally-" + suffix}, 'locality', ${city.id}, ${city.id}, ${[state.id, city.id]}, '500085', 'seed_curated')
    RETURNING id`;
  createdAreaIds.push(locality.id);

  return { stateId: state.id as string, cityId: city.id as string, localityId: locality.id as string, suffix };
}

describe("searchAreas", () => {
  it("returns nothing for a query under 2 characters", async () => {
    expect(await searchAreas(db, "a")).toEqual([]);
  });

  it("matches by name prefix", async () => {
    const { localityId, suffix } = await seedTree(randomSuffix());
    const results = await searchAreas(db, `Test Kukatpally ${suffix.slice(0, 4)}`);
    expect(results.map((r) => r.id)).toContain(localityId);
  });

  it("matches a typo via trigram similarity", async () => {
    const { localityId, suffix } = await seedTree(randomSuffix());
    // "Kukataplly" instead of "Kukatpally" — transposed/dropped letters,
    // close enough for pg_trgm's default similarity threshold.
    const results = await searchAreas(db, `Test Kukataplly ${suffix}`);
    expect(results.map((r) => r.id)).toContain(localityId);
  });

  it("matches an exact 6-digit PIN, locality rows only", async () => {
    const { localityId } = await seedTree(randomSuffix());
    const results = await searchAreas(db, "500085");
    expect(results.map((r) => r.id)).toContain(localityId);
    expect(results.every((r) => r.areaLevel === "locality")).toBe(true);
  });

  it("builds the label from the ancestor chain, nearest place first", async () => {
    const { localityId, suffix } = await seedTree(randomSuffix());
    const results = await searchAreas(db, `Test Kukatpally ${suffix}`);
    const match = results.find((r) => r.id === localityId);
    expect(match?.label).toBe(`Test Kukatpally ${suffix}, Test Search City ${suffix}, Test Search State ${suffix}`);
  });

  it("scopes to one city when cityAreaId is given", async () => {
    const a = await seedTree(randomSuffix());
    const b = await seedTree(randomSuffix());
    const results = await searchAreas(db, "Test Kukatpally", { cityAreaId: a.cityId });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(a.localityId);
    expect(ids).not.toContain(b.localityId);
  });

  it("restricts to the given levels", async () => {
    const { cityId, suffix } = await seedTree(randomSuffix());
    const results = await searchAreas(db, `Test Search City ${suffix}`, { levels: ["city"] });
    expect(results.map((r) => r.id)).toContain(cityId);
    expect(results.every((r) => r.areaLevel === "city")).toBe(true);
  });
});

// A short random suffix, not a full UUID — UUIDs contain digit runs that
// can spuriously satisfy the 6-digit PIN pattern once concatenated with
// surrounding text, and this keeps names short enough to eyeball in a
// failing assertion.
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
