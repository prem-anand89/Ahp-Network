// Round 3 step C — "Where you work" (profile edit's write path for
// home_visit_areas). Runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { getMyCoverageTx, replaceCoverageTx } from "./coverage";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdAreaIds: string[] = [];

afterEach(async () => {
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM home_visit_areas WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
  let areaId: string | undefined;
  while ((areaId = createdAreaIds.pop()) !== undefined) {
    await client`DELETE FROM areas WHERE id = ${areaId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createCity() {
  const [city] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"Test City " + crypto.randomUUID()}, ${"test-city-" + crypto.randomUUID()}, 'city')
    RETURNING id`;
  createdAreaIds.push(city.id);
  return city.id as string;
}

async function createLocality(cityAreaId: string) {
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, city_area_id) VALUES (${"Test Locality " + crypto.randomUUID()}, ${"test-locality-" + crypto.randomUUID()}, 'locality', ${cityAreaId})
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return locality.id as string;
}

async function createUser(): Promise<string> {
  const email = `coverage-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("replaceCoverageTx / getMyCoverageTx (Round 3 step C — profile edit)", () => {
  it("round-trips a fresh coverage set through getMyCoverageTx", async () => {
    const userId = await createUser();
    const cityId = await createCity();
    const base = await createLocality(cityId);
    const secondary = await createLocality(cityId);

    await replaceCoverageTx(db, userId, base, [
      { cityAreaId: cityId, areaId: base, tier: "primary" },
      { cityAreaId: cityId, areaId: secondary, tier: "secondary" },
    ]);

    const result = await getMyCoverageTx(db, userId);
    expect(result.baseAreaId).toBe(base);
    expect(result.cities).toEqual([{ id: cityId, name: expect.any(String) }]);
    expect(result.coverage).toHaveLength(2);
    expect(result.coverage).toContainEqual({ cityAreaId: cityId, areaId: base, tier: "primary" });
    expect(result.coverage).toContainEqual({ cityAreaId: cityId, areaId: secondary, tier: "secondary" });
  });

  it("replaces rather than accumulates — a second call fully supersedes the first", async () => {
    const userId = await createUser();
    const cityId = await createCity();
    const base = await createLocality(cityId);
    const droppedArea = await createLocality(cityId);
    const keptArea = await createLocality(cityId);

    await replaceCoverageTx(db, userId, base, [
      { cityAreaId: cityId, areaId: base, tier: "primary" },
      { cityAreaId: cityId, areaId: droppedArea, tier: "secondary" },
    ]);
    await replaceCoverageTx(db, userId, base, [
      { cityAreaId: cityId, areaId: base, tier: "primary" },
      { cityAreaId: cityId, areaId: keptArea, tier: "secondary" },
    ]);

    const result = await getMyCoverageTx(db, userId);
    const areaIds = result.coverage.map((r) => r.areaId);
    expect(areaIds).toContain(keptArea);
    expect(areaIds).not.toContain(droppedArea);
    expect(areaIds).toHaveLength(2);
  });

  it("never leaves two is_primary rows for the same therapist across a replace", async () => {
    const userId = await createUser();
    const cityId = await createCity();
    const firstBase = await createLocality(cityId);
    const secondBase = await createLocality(cityId);

    await replaceCoverageTx(db, userId, firstBase, [{ cityAreaId: cityId, areaId: firstBase, tier: "primary" }]);
    await replaceCoverageTx(db, userId, secondBase, [{ cityAreaId: cityId, areaId: secondBase, tier: "primary" }]);

    const rows = await client`SELECT area_id, is_primary FROM home_visit_areas WHERE user_id = ${userId} AND deleted_at IS NULL AND is_primary`;
    expect(rows).toHaveLength(1);
    expect(rows[0].area_id).toBe(secondBase);
  });

  it("returns an empty shape for a therapist with no coverage yet", async () => {
    const userId = await createUser();
    const result = await getMyCoverageTx(db, userId);
    expect(result).toEqual({ baseAreaId: null, cities: [], coverage: [] });
  });
});
