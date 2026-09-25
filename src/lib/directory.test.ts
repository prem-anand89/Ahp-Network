// Runs against a real Postgres (local dev instance), never mocks — per
// BUILD_SEQUENCE.md Phase 0's test-stack convention.
//
// Phase 5's own "Done when": every filter in the taxonomy narrows the
// result set without changing sort order. Tested here against a handful
// of seeded profiles spanning both verification tiers and both roles.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { getDirectoryCities, searchDirectory, searchTherapistsByName } from "./directory";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";

const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdAreaIds: string[] = [];

afterEach(async () => {
  let id: string | undefined;
  while ((id = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM credentials WHERE user_id = ${id}`;
    await client`DELETE FROM home_visit_areas WHERE user_id = ${id}`;
    await client`DELETE FROM users WHERE id = ${id}`;
    await client`DELETE FROM auth.users WHERE id = ${id}`;
  }
  let areaId: string | undefined;
  while ((areaId = createdAreaIds.pop()) !== undefined) {
    await client`DELETE FROM areas WHERE id = ${areaId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function seedTherapist(opts: {
  email: string;
  role: "physiotherapist" | "occupational_therapist";
  verificationStage: "unverified" | "qualification_confirmed" | "credentials_verified";
  capacityState?: "available" | "limited" | "not_taking";
  displayName?: string;
}): Promise<string> {
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${opts.email}) RETURNING id`;
  await client`
    INSERT INTO users (
      id, email, account_type, display_name, role, verification_stage,
      profile_status, profile_visibility, capacity_state
    ) VALUES (
      ${authUser.id}, ${opts.email}, 'therapist', ${opts.displayName ?? opts.email}, ${opts.role},
      ${opts.verificationStage}, 'active', 'public', ${opts.capacityState ?? 'not_taking'}
    )`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("searchDirectory — §9 filter taxonomy and sort order", () => {
  it("the role filter narrows the result set without touching sort order", async () => {
    await seedTherapist({
      email: "dir-pt-1@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await seedTherapist({
      email: "dir-ot-1@example.com",
      role: "occupational_therapist",
      verificationStage: "credentials_verified",
    });

    const physios = await searchDirectory(db, { role: "physiotherapist" });
    expect(physios.every((p) => p.role === "physiotherapist")).toBe(true);
    expect(physios.some((p) => p.role === "occupational_therapist")).toBe(false);
  });

  it("[E4] verifiedOnly defaults off — qualification_confirmed profiles are still returned", async () => {
    await seedTherapist({
      email: "dir-qc-1@example.com",
      role: "physiotherapist",
      verificationStage: "qualification_confirmed",
    });

    const results = await searchDirectory(db, {});
    expect(results.some((p) => p.verificationStage === "qualification_confirmed")).toBe(true);
  });

  it("verifiedOnly, when explicitly turned on, excludes qualification_confirmed profiles", async () => {
    const qcId = await seedTherapist({
      email: "dir-qc-2@example.com",
      role: "physiotherapist",
      verificationStage: "qualification_confirmed",
    });
    await seedTherapist({
      email: "dir-cv-2@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });

    const results = await searchDirectory(db, { verifiedOnly: true });
    expect(results.some((p) => p.id === qcId)).toBe(false);
    expect(results.every((p) => p.verificationStage === "credentials_verified")).toBe(true);
  });

  it("sorts credentials_verified before qualification_confirmed before unverified, regardless of filters", async () => {
    await seedTherapist({
      email: "dir-sort-unverified@example.com",
      role: "physiotherapist",
      verificationStage: "unverified",
    });
    await seedTherapist({
      email: "dir-sort-cv@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await seedTherapist({
      email: "dir-sort-qc@example.com",
      role: "physiotherapist",
      verificationStage: "qualification_confirmed",
    });

    const results = await searchDirectory(db, { role: "physiotherapist" });
    const tiers = results.map((p) => p.verificationStage);
    const firstUnverified = tiers.indexOf("unverified");
    const firstQc = tiers.indexOf("qualification_confirmed");
    const firstCv = tiers.indexOf("credentials_verified");

    expect(firstCv).toBeLessThan(firstQc === -1 ? Infinity : firstQc);
    expect(firstQc).toBeLessThan(firstUnverified === -1 ? Infinity : firstUnverified);
  });

  it("carries verifiedSince through (Phase 3 fix — this was never queried, so every card's badge tooltip read '— .')", async () => {
    const userId = await seedTherapist({
      email: "dir-verified-since@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await client`
      INSERT INTO credentials (user_id, type, status, verified_at)
      VALUES (${userId}, 'degree', 'approved', '2026-03-12T00:00:00Z')`;

    const [result] = await searchDirectory(db, { role: "physiotherapist" });
    expect(result.verifiedSince).not.toBeNull();
    expect(new Date(result.verifiedSince!).getUTCFullYear()).toBe(2026);
  });

  it("verifiedSince is null for a profile with no approved credential", async () => {
    await seedTherapist({
      email: "dir-no-credential@example.com",
      role: "physiotherapist",
      verificationStage: "unverified",
    });

    const [result] = await searchDirectory(db, { role: "physiotherapist" });
    expect(result.verifiedSince).toBeNull();
  });

  it("Step 5 (decision 11) — omits localityLabel when the therapist's only home-visit area is pending_review", async () => {
    const [pending] = await client`
      INSERT INTO areas (name, slug, area_level, curation_status)
      VALUES (${"Pending Dir Locality " + crypto.randomUUID()}, ${"pending-dir-locality-" + crypto.randomUUID()}, 'locality', 'pending_review')
      RETURNING id`;
    createdAreaIds.push(pending.id);
    const userId = await seedTherapist({
      email: "dir-pending-area@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${userId}, ${pending.id})`;

    const results = await searchDirectory(db, { role: "physiotherapist" });
    const result = results.find((r) => r.id === userId);
    expect(result?.localityLabel).toBeNull();
  });

  it("Step 5 (decision 11) — shows localityLabel once the area is approved", async () => {
    const areaName = "Approved Dir Locality " + crypto.randomUUID();
    const [approved] = await client`
      INSERT INTO areas (name, slug, area_level, curation_status)
      VALUES (${areaName}, ${"approved-dir-locality-" + crypto.randomUUID()}, 'locality', 'approved')
      RETURNING id`;
    createdAreaIds.push(approved.id);
    const userId = await seedTherapist({
      email: "dir-approved-area@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${userId}, ${approved.id})`;

    const results = await searchDirectory(db, { role: "physiotherapist" });
    const result = results.find((r) => r.id === userId);
    expect(result?.localityLabel).toBe(areaName);
  });

  it("Round 3 step C — a secondary-tier area never appears as localityLabel or matches the area filter", async () => {
    const primaryName = "Primary Dir Locality " + crypto.randomUUID();
    const [primary] = await client`
      INSERT INTO areas (name, slug, area_level, curation_status)
      VALUES (${primaryName}, ${"primary-dir-locality-" + crypto.randomUUID()}, 'locality', 'approved')
      RETURNING id`;
    createdAreaIds.push(primary.id);
    const secondaryName = "Secondary Dir Locality " + crypto.randomUUID();
    const [secondary] = await client`
      INSERT INTO areas (name, slug, area_level, curation_status)
      VALUES (${secondaryName}, ${"secondary-dir-locality-" + crypto.randomUUID()}, 'locality', 'approved')
      RETURNING id`;
    createdAreaIds.push(secondary.id);
    const userId = await seedTherapist({
      email: "dir-secondary-area@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await client`INSERT INTO home_visit_areas (user_id, area_id, tier) VALUES (${userId}, ${primary.id}, 'primary')`;
    await client`INSERT INTO home_visit_areas (user_id, area_id, tier) VALUES (${userId}, ${secondary.id}, 'secondary')`;

    const results = await searchDirectory(db, { role: "physiotherapist" });
    const result = results.find((r) => r.id === userId);
    expect(result?.localityLabel).toBe(primaryName);

    const bySecondary = await searchDirectory(db, { areaId: secondary.id });
    expect(bySecondary.some((r) => r.id === userId)).toBe(false);

    const byPrimary = await searchDirectory(db, { areaId: primary.id });
    expect(byPrimary.some((r) => r.id === userId)).toBe(true);
  });

  describe("Round 3 step F — cityAreaId filter and ancestor_ids-based area matching", () => {
    async function createCity(): Promise<string> {
      const [city] = await client`
        INSERT INTO areas (name, slug, area_level) VALUES (${"Dir City " + crypto.randomUUID()}, ${"dir-city-" + crypto.randomUUID()}, 'city')
        RETURNING id`;
      createdAreaIds.push(city.id);
      await client`UPDATE areas SET city_area_id = ${city.id} WHERE id = ${city.id}`;
      return city.id;
    }

    async function createZone(cityAreaId: string): Promise<string> {
      const [zone] = await client`
        INSERT INTO areas (name, slug, area_level, city_area_id, ancestor_ids)
        VALUES (${"Dir Zone " + crypto.randomUUID()}, ${"dir-zone-" + crypto.randomUUID()}, 'zone', ${cityAreaId}, ARRAY[${cityAreaId}]::uuid[])
        RETURNING id`;
      createdAreaIds.push(zone.id);
      return zone.id;
    }

    async function createLocalityIn(cityAreaId: string, zoneAreaId: string): Promise<string> {
      const [locality] = await client`
        INSERT INTO areas (name, slug, area_level, city_area_id, ancestor_ids)
        VALUES (${"Dir Locality " + crypto.randomUUID()}, ${"dir-locality-" + crypto.randomUUID()}, 'locality', ${cityAreaId}, ARRAY[${cityAreaId}, ${zoneAreaId}]::uuid[])
        RETURNING id`;
      createdAreaIds.push(locality.id);
      return locality.id;
    }

    it("cityAreaId matches a therapist whose primary coverage is anywhere in that city", async () => {
      const cityId = await createCity();
      const zoneId = await createZone(cityId);
      const localityId = await createLocalityIn(cityId, zoneId);
      const userId = await seedTherapist({
        email: "dir-city-filter@example.com",
        role: "physiotherapist",
        verificationStage: "credentials_verified",
      });
      await client`INSERT INTO home_visit_areas (user_id, area_id, tier) VALUES (${userId}, ${localityId}, 'primary')`;

      const results = await searchDirectory(db, { cityAreaId: cityId });
      expect(results.some((r) => r.id === userId)).toBe(true);

      const otherCityId = await createCity();
      const byOtherCity = await searchDirectory(db, { cityAreaId: otherCityId });
      expect(byOtherCity.some((r) => r.id === userId)).toBe(false);
    });

    it("areaId matches a therapist whose primary coverage is the whole zone above that locality", async () => {
      const cityId = await createCity();
      const zoneId = await createZone(cityId);
      const localityId = await createLocalityIn(cityId, zoneId);
      const userId = await seedTherapist({
        email: "dir-zone-coverage@example.com",
        role: "physiotherapist",
        verificationStage: "credentials_verified",
      });
      // Whole-zone primary coverage, not the exact locality.
      await client`INSERT INTO home_visit_areas (user_id, area_id, tier) VALUES (${userId}, ${zoneId}, 'primary')`;

      const byLocality = await searchDirectory(db, { areaId: localityId });
      expect(byLocality.some((r) => r.id === userId)).toBe(true);

      const byZone = await searchDirectory(db, { areaId: zoneId });
      expect(byZone.some((r) => r.id === userId)).toBe(true);
    });

    it("areaId does not match a therapist covering only a different locality in the same zone", async () => {
      const cityId = await createCity();
      const zoneId = await createZone(cityId);
      const localityA = await createLocalityIn(cityId, zoneId);
      const localityB = await createLocalityIn(cityId, zoneId);
      const userId = await seedTherapist({
        email: "dir-sibling-locality@example.com",
        role: "physiotherapist",
        verificationStage: "credentials_verified",
      });
      await client`INSERT INTO home_visit_areas (user_id, area_id, tier) VALUES (${userId}, ${localityA}, 'primary')`;

      const results = await searchDirectory(db, { areaId: localityB });
      expect(results.some((r) => r.id === userId)).toBe(false);
    });
  });
});

describe("getDirectoryCities — Round 3 step F", () => {
  async function createCity(): Promise<string> {
    const [city] = await client`
      INSERT INTO areas (name, slug, area_level) VALUES (${"Cities Test " + crypto.randomUUID()}, ${"cities-test-" + crypto.randomUUID()}, 'city')
      RETURNING id`;
    createdAreaIds.push(city.id);
    await client`UPDATE areas SET city_area_id = ${city.id} WHERE id = ${city.id}`;
    return city.id;
  }

  it("includes a city with ≥1 listed therapist and excludes one with none", async () => {
    const coveredCityId = await createCity();
    const [coveredCityName] = await client`SELECT name FROM areas WHERE id = ${coveredCityId}`;
    const localityId = (
      await client`
        INSERT INTO areas (name, slug, area_level, city_area_id, ancestor_ids)
        VALUES (${"Cities Test Locality " + crypto.randomUUID()}, ${"cities-test-locality-" + crypto.randomUUID()}, 'locality', ${coveredCityId}, ARRAY[${coveredCityId}]::uuid[])
        RETURNING id`
    )[0].id;
    createdAreaIds.push(localityId);
    const userId = await seedTherapist({
      email: "dir-cities-filter@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await client`INSERT INTO home_visit_areas (user_id, area_id, tier) VALUES (${userId}, ${localityId}, 'primary')`;

    const emptyCityId = await createCity();

    const cities = await getDirectoryCities(db);
    expect(cities.some((c) => c.id === coveredCityId && c.name === coveredCityName.name)).toBe(true);
    expect(cities.some((c) => c.id === emptyCityId)).toBe(false);
  });
});

// Phase 5 — the circle member picker's name search, replacing "type the
// person's URL slug by hand."
describe("searchTherapistsByName", () => {
  it("matches a partial, case-insensitive name", async () => {
    const excludeId = await seedTherapist({
      email: "dir-search-excluder@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await seedTherapist({
      email: "dir-search-priya@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
      displayName: "Priya Sharma",
    });

    const results = await searchTherapistsByName(db, "priya", excludeId);
    expect(results.some((r) => r.displayName === "Priya Sharma")).toBe(true);
  });

  it("excludes the caller's own row", async () => {
    const selfId = await seedTherapist({
      email: "dir-search-self@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
      displayName: "Search Selfie",
    });

    const results = await searchTherapistsByName(db, "Selfie", selfId);
    expect(results.some((r) => r.id === selfId)).toBe(false);
  });

  it("returns nothing for a query under 2 characters", async () => {
    const excludeId = await seedTherapist({
      email: "dir-search-short@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    const results = await searchTherapistsByName(db, "p", excludeId);
    expect(results).toEqual([]);
  });
});
