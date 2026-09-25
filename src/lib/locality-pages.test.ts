// Runs against a real Postgres (local dev instance), never mocks — per
// BUILD_SEQUENCE.md Phase 0's test-stack convention.
//
// Round 3 — areas_slug_unique_within_city (schema.ts) only guarantees a
// locality's slug is unique within its own city, not nationwide, so
// resolveLocality must scope its locality lookup by the resolved city's
// id. The cross-city-slug-collision test below is exactly the bug this
// file's own header comment documents: an unscoped lookup could match the
// wrong city's same-named locality and then wrongly 404.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { getSitemapEligibleLocalities, LOCALITY_SITEMAP_MIN_THERAPISTS, resolveLocality } from "./locality-pages";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";

const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdAreaIds: string[] = [];
const createdUserIds: string[] = [];

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

async function createCity(name: string, slug: string): Promise<string> {
  const [city] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${name}, ${slug}, 'city')
    RETURNING id`;
  createdAreaIds.push(city.id);
  await client`UPDATE areas SET city_area_id = ${city.id} WHERE id = ${city.id}`;
  return city.id;
}

async function createZone(cityAreaId: string, name: string, slug: string): Promise<string> {
  const [zone] = await client`
    INSERT INTO areas (name, slug, area_level, city_area_id, ancestor_ids)
    VALUES (${name}, ${slug}, 'zone', ${cityAreaId}, ARRAY[${cityAreaId}]::uuid[])
    RETURNING id`;
  createdAreaIds.push(zone.id);
  return zone.id;
}

async function createLocality(
  cityAreaId: string,
  name: string,
  slug: string,
  zoneAreaId?: string,
): Promise<string> {
  const ancestorIds = zoneAreaId ? [cityAreaId, zoneAreaId] : [cityAreaId];
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, city_area_id, ancestor_ids)
    VALUES (${name}, ${slug}, 'locality', ${cityAreaId}, ${ancestorIds}::uuid[])
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return locality.id;
}

async function createTherapist(opts: {
  verificationStage?: "unverified" | "qualification_confirmed" | "credentials_verified";
  profileStatus?: "draft" | "active" | "suspended";
  profileVisibility?: "public" | "private";
}): Promise<string> {
  const email = `sitemap-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, verification_stage, profile_status, profile_visibility)
    VALUES (
      ${authUser.id}, ${email}, 'therapist', ${opts.verificationStage ?? "credentials_verified"},
      ${opts.profileStatus ?? "active"}, ${opts.profileVisibility ?? "public"}
    )`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function coverPrimary(userId: string, areaId: string): Promise<void> {
  await client`INSERT INTO home_visit_areas (user_id, area_id, tier) VALUES (${userId}, ${areaId}, 'primary')`;
}

describe("resolveLocality", () => {
  it("resolves a city + locality slug pair", async () => {
    const cityId = await createCity("Test City " + crypto.randomUUID(), "test-city-" + crypto.randomUUID());
    const localityId = await createLocality(cityId, "Gandhi Nagar", "gandhi-nagar-" + crypto.randomUUID());

    const [citySlug] = await client`SELECT slug FROM areas WHERE id = ${cityId}`;
    const [localitySlug] = await client`SELECT slug FROM areas WHERE id = ${localityId}`;

    const resolved = await resolveLocality(db, citySlug.slug, localitySlug.slug);
    expect(resolved?.city.id).toBe(cityId);
    expect(resolved?.locality.id).toBe(localityId);
  });

  it("returns null for an unknown city slug", async () => {
    const resolved = await resolveLocality(db, "no-such-city-" + crypto.randomUUID(), "no-such-locality");
    expect(resolved).toBeNull();
  });

  it("returns null when the locality doesn't belong to that city", async () => {
    const cityAId = await createCity("City A " + crypto.randomUUID(), "city-a-" + crypto.randomUUID());
    const cityBId = await createCity("City B " + crypto.randomUUID(), "city-b-" + crypto.randomUUID());
    const localityInB = await createLocality(cityBId, "Only In B", "only-in-b-" + crypto.randomUUID());

    const [citySlugA] = await client`SELECT slug FROM areas WHERE id = ${cityAId}`;
    const [localitySlugB] = await client`SELECT slug FROM areas WHERE id = ${localityInB}`;

    const resolved = await resolveLocality(db, citySlugA.slug, localitySlugB.slug);
    expect(resolved).toBeNull();
  });

  it("Round 3 — resolves the right locality when two different cities share a locality slug", async () => {
    // areas_slug_unique_within_city only enforces uniqueness per city, so
    // this is a legitimate, expected shape once the national registry is
    // loaded — "gandhi-nagar" exists in many cities.
    const cityAId = await createCity("City A " + crypto.randomUUID(), "city-a-" + crypto.randomUUID());
    const cityBId = await createCity("City B " + crypto.randomUUID(), "city-b-" + crypto.randomUUID());
    const sharedSlug = "gandhi-nagar-" + crypto.randomUUID();
    const localityInA = await createLocality(cityAId, "Gandhi Nagar", sharedSlug);
    const localityInB = await createLocality(cityBId, "Gandhi Nagar", sharedSlug);

    const [citySlugA] = await client`SELECT slug FROM areas WHERE id = ${cityAId}`;
    const [citySlugB] = await client`SELECT slug FROM areas WHERE id = ${cityBId}`;

    const resolvedA = await resolveLocality(db, citySlugA.slug, sharedSlug);
    expect(resolvedA?.city.id).toBe(cityAId);
    expect(resolvedA?.locality.id).toBe(localityInA);

    const resolvedB = await resolveLocality(db, citySlugB.slug, sharedSlug);
    expect(resolvedB?.city.id).toBe(cityBId);
    expect(resolvedB?.locality.id).toBe(localityInB);
  });
});

describe("getSitemapEligibleLocalities — Round 3 step F thin-content guard", () => {
  it("excludes a locality with no covering therapists", async () => {
    const cityId = await createCity("Test City " + crypto.randomUUID(), "test-city-" + crypto.randomUUID());
    const localitySlug = "empty-locality-" + crypto.randomUUID();
    await createLocality(cityId, "Empty Locality", localitySlug);

    const rows = await getSitemapEligibleLocalities(db);
    expect(rows.some((r) => r.localitySlug === localitySlug)).toBe(false);
  });

  it("excludes a locality under LOCALITY_SITEMAP_MIN_THERAPISTS covering therapists", async () => {
    const cityId = await createCity("Test City " + crypto.randomUUID(), "test-city-" + crypto.randomUUID());
    const localitySlug = "thin-locality-" + crypto.randomUUID();
    const localityId = await createLocality(cityId, "Thin Locality", localitySlug);
    for (let i = 0; i < LOCALITY_SITEMAP_MIN_THERAPISTS - 1; i++) {
      const userId = await createTherapist({});
      await coverPrimary(userId, localityId);
    }

    const rows = await getSitemapEligibleLocalities(db);
    expect(rows.some((r) => r.localitySlug === localitySlug)).toBe(false);
  });

  it("includes a locality once it clears LOCALITY_SITEMAP_MIN_THERAPISTS covering therapists", async () => {
    const cityId = await createCity("Test City " + crypto.randomUUID(), "test-city-" + crypto.randomUUID());
    const citySlug = "test-city-" + crypto.randomUUID();
    await client`UPDATE areas SET slug = ${citySlug} WHERE id = ${cityId}`;
    const localitySlug = "busy-locality-" + crypto.randomUUID();
    const localityId = await createLocality(cityId, "Busy Locality", localitySlug);
    for (let i = 0; i < LOCALITY_SITEMAP_MIN_THERAPISTS; i++) {
      const userId = await createTherapist({});
      await coverPrimary(userId, localityId);
    }

    const rows = await getSitemapEligibleLocalities(db);
    expect(rows).toContainEqual({ citySlug, localitySlug });
  });

  it("counts a therapist who covers the whole zone containing the locality", async () => {
    const cityId = await createCity("Test City " + crypto.randomUUID(), "test-city-" + crypto.randomUUID());
    const zoneId = await createZone(cityId, "Test Zone " + crypto.randomUUID(), "test-zone-" + crypto.randomUUID());
    const localitySlug = "zone-covered-locality-" + crypto.randomUUID();
    await createLocality(cityId, "Zone-Covered Locality", localitySlug, zoneId);
    for (let i = 0; i < LOCALITY_SITEMAP_MIN_THERAPISTS; i++) {
      const userId = await createTherapist({});
      await coverPrimary(userId, zoneId); // whole-zone primary coverage, not the locality itself
    }

    const rows = await getSitemapEligibleLocalities(db);
    expect(rows.some((r) => r.localitySlug === localitySlug)).toBe(true);
  });

  it("excludes an unverified covering therapist from the count", async () => {
    const cityId = await createCity("Test City " + crypto.randomUUID(), "test-city-" + crypto.randomUUID());
    const localitySlug = "unverified-covered-locality-" + crypto.randomUUID();
    const localityId = await createLocality(cityId, "Unverified-Covered Locality", localitySlug);
    for (let i = 0; i < LOCALITY_SITEMAP_MIN_THERAPISTS; i++) {
      const userId = await createTherapist({ verificationStage: "unverified" });
      await coverPrimary(userId, localityId);
    }

    const rows = await getSitemapEligibleLocalities(db);
    expect(rows.some((r) => r.localitySlug === localitySlug)).toBe(false);
  });
});
