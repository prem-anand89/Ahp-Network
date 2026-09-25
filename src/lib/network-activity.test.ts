// §9/§10H — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { getNetworkActivityFeed } from "./network-activity";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdAreaIds: string[] = [];
const createdReferralIds: string[] = [];

afterEach(async () => {
  let referralId: string | undefined;
  while ((referralId = createdReferralIds.pop()) !== undefined) {
    await client`DELETE FROM home_case_referrals WHERE id = ${referralId}`;
  }
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

async function createCity(): Promise<string> {
  const [city] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"Test City " + crypto.randomUUID()}, ${"test-city-" + crypto.randomUUID()}, 'city')
    RETURNING id`;
  createdAreaIds.push(city.id);
  await client`UPDATE areas SET city_area_id = ${city.id} WHERE id = ${city.id}`;
  return city.id as string;
}

async function createLocality(cityId?: string): Promise<{ cityId: string; localityId: string }> {
  const city = cityId ?? (await createCity());
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, city_area_id) VALUES (${"Test Locality " + crypto.randomUUID()}, ${"test-locality-" + crypto.randomUUID()}, 'locality', ${city})
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return { cityId: city, localityId: locality.id as string };
}

async function createZoneAndLocality(cityId?: string): Promise<{ cityId: string; zoneId: string; localityId: string }> {
  const city = cityId ?? (await createCity());
  const [zone] = await client`
    INSERT INTO areas (name, slug, area_level, parent_id, city_area_id) VALUES (${"Test Zone " + crypto.randomUUID()}, ${"test-zone-" + crypto.randomUUID()}, 'zone', ${city}, ${city})
    RETURNING id`;
  createdAreaIds.push(zone.id);
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, parent_id, city_area_id) VALUES (${"Test Zoned Locality " + crypto.randomUUID()}, ${"test-zoned-locality-" + crypto.randomUUID()}, 'locality', ${zone.id}, ${city})
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return { cityId: city, zoneId: zone.id as string, localityId: locality.id as string };
}

async function createTherapist(opts: {
  role: string;
  specializations: string[];
  verificationStage?: string;
  areaId?: string;
  /** Base locality (home_visit_areas.is_primary) — distinct from areaId's
   * plain coverage row. D2's clinic matching reads only the base. */
  baseAreaId?: string;
  acceptsClinicVisits?: boolean;
}): Promise<string> {
  const email = `feed-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, role, specializations, verification_stage, accepts_clinic_visits)
    VALUES (${authUser.id}, ${email}, 'therapist', ${opts.role}, ${opts.specializations}, ${opts.verificationStage ?? "credentials_verified"}, ${opts.acceptsClinicVisits ?? true})`;
  createdUserIds.push(authUser.id);
  if (opts.areaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${opts.areaId})`;
  }
  if (opts.baseAreaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id, is_primary) VALUES (${authUser.id}, ${opts.baseAreaId}, true)`;
  }
  return authUser.id;
}

async function createOpenReferral(posterId: string, areaId: string, cityId: string): Promise<string> {
  const [ref] = await client`
    INSERT INTO home_case_referrals (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, area_id, city_area_id, patient_consent_recorded_at)
    VALUES (${posterId}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', true, ${areaId}, ${cityId}, now())
    RETURNING id`;
  createdReferralIds.push(ref.id);
  return ref.id;
}

async function createOpenClinicReferral(posterId: string, areaId: string, cityId: string): Promise<string> {
  const [ref] = await client`
    INSERT INTO home_case_referrals (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, area_id, city_area_id, patient_consent_recorded_at)
    VALUES (${posterId}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', false, ${areaId}, ${cityId}, now())
    RETURNING id`;
  createdReferralIds.push(ref.id);
  return ref.id;
}

describe("getNetworkActivityFeed (§9)", () => {
  it("shows every open referral in the viewer's own city, marking whether the viewer matches", async () => {
    const { cityId, localityId } = await createLocality();
    const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
    const referralId = await createOpenReferral(poster, localityId, cityId);

    const matchingViewer = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      areaId: localityId,
    });
    // Same city, wrong role/specialization — still shown (city-scoped
    // activity awareness), just marked non-matching.
    const nonMatchingViewer = await createTherapist({
      role: "occupational_therapist",
      specializations: [],
      areaId: localityId,
    });

    const feedForMatch = await getNetworkActivityFeed(db, matchingViewer);
    const feedForNonMatch = await getNetworkActivityFeed(db, nonMatchingViewer);

    const inMatch = feedForMatch.find((i) => i.kind === "referral" && i.id === referralId);
    const inNonMatch = feedForNonMatch.find((i) => i.kind === "referral" && i.id === referralId);

    expect(inMatch && "matchesViewer" in inMatch ? inMatch.matchesViewer : undefined).toBe(true);
    expect(inNonMatch && "matchesViewer" in inNonMatch ? inNonMatch.matchesViewer : undefined).toBe(false);
  });

  it("Round 3 step D (review finding 5) — excludes a referral posted in a different city", async () => {
    const { cityId, localityId } = await createLocality();
    const { localityId: otherCityLocalityId } = await createLocality();
    const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
    const referralId = await createOpenReferral(poster, localityId, cityId);

    const otherCityViewer = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      areaId: otherCityLocalityId,
    });

    const feed = await getNetworkActivityFeed(db, otherCityViewer);
    expect(feed.find((i) => i.kind === "referral" && i.id === referralId)).toBeUndefined();
  });

  it("Round 3 decision 1 — a qualification_confirmed viewer also matches, not just credentials_verified", async () => {
    const { cityId, localityId } = await createLocality();
    const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
    const referralId = await createOpenReferral(poster, localityId, cityId);

    const qualifiedViewer = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      areaId: localityId,
      verificationStage: "qualification_confirmed",
    });
    const unverifiedViewer = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      areaId: localityId,
      verificationStage: "unverified",
    });

    const feedForQualified = await getNetworkActivityFeed(db, qualifiedViewer);
    const feedForUnverified = await getNetworkActivityFeed(db, unverifiedViewer);

    const inQualified = feedForQualified.find((i) => i.kind === "referral" && i.id === referralId);
    const inUnverified = feedForUnverified.find((i) => i.kind === "referral" && i.id === referralId);

    expect(inQualified && "matchesViewer" in inQualified ? inQualified.matchesViewer : undefined).toBe(true);
    expect(inUnverified && "matchesViewer" in inUnverified ? inUnverified.matchesViewer : undefined).toBe(false);
  });

  it("Round 3 step F — localityLabel is 'Locality, City', not a bare locality name", async () => {
    const { cityId, localityId } = await createLocality();
    const [{ name: localityName }] = await client`SELECT name FROM areas WHERE id = ${localityId}`;
    const [{ name: cityName }] = await client`SELECT name FROM areas WHERE id = ${cityId}`;
    const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
    const referralId = await createOpenReferral(poster, localityId, cityId);
    const viewer = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      areaId: localityId,
    });

    const feed = await getNetworkActivityFeed(db, viewer);
    const item = feed.find((i) => i.kind === "referral" && i.id === referralId);
    expect(item && "localityLabel" in item ? item.localityLabel : undefined).toBe(`${localityName}, ${cityName}`);
  });

  describe("Round 3 step D (D2, review fix) — a clinic referral matches on base/practice location, not home-visit coverage", () => {
    it("does NOT flag a match when the viewer's only link is secondary home-visit coverage there", async () => {
      const { cityId, localityId } = await createLocality();
      const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
      const referralId = await createOpenClinicReferral(poster, localityId, cityId);

      const viewer = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        areaId: localityId, // coverage, not base — must not count for a clinic visit
      });

      const feed = await getNetworkActivityFeed(db, viewer);
      const item = feed.find((i) => i.kind === "referral" && i.id === referralId);
      expect(item && "matchesViewer" in item ? item.matchesViewer : undefined).toBe(false);
    });

    it("flags a match when the viewer's base locality is the referral's exact locality", async () => {
      const { cityId, localityId } = await createLocality();
      const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
      const referralId = await createOpenClinicReferral(poster, localityId, cityId);

      const viewer = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: localityId,
      });

      const feed = await getNetworkActivityFeed(db, viewer);
      const item = feed.find((i) => i.kind === "referral" && i.id === referralId);
      expect(item && "matchesViewer" in item ? item.matchesViewer : undefined).toBe(true);
    });

    it("flags a match when the viewer's base locality is a different locality in the same zone", async () => {
      const { zoneId, cityId, localityId: referralLocalityId } = await createZoneAndLocality();
      const [otherLocalityInZone] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, city_area_id)
        VALUES (${"Same Zone Locality " + crypto.randomUUID()}, ${"same-zone-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${cityId})
        RETURNING id`;
      createdAreaIds.push(otherLocalityInZone.id);
      const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
      const referralId = await createOpenClinicReferral(poster, referralLocalityId, cityId);

      const viewer = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: otherLocalityInZone.id,
      });

      const feed = await getNetworkActivityFeed(db, viewer);
      const item = feed.find((i) => i.kind === "referral" && i.id === referralId);
      expect(item && "matchesViewer" in item ? item.matchesViewer : undefined).toBe(true);
    });

    it("does NOT flag a match when the viewer's base locality is a different zone in the same city", async () => {
      const { cityId, localityId: referralLocalityId } = await createZoneAndLocality();
      const { localityId: otherZoneLocalityId } = await createZoneAndLocality(cityId);
      const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
      const referralId = await createOpenClinicReferral(poster, referralLocalityId, cityId);

      const viewer = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: otherZoneLocalityId,
      });

      const feed = await getNetworkActivityFeed(db, viewer);
      const item = feed.find((i) => i.kind === "referral" && i.id === referralId);
      expect(item && "matchesViewer" in item ? item.matchesViewer : undefined).toBe(false);
    });
  });

  it("never exposes patient_summary — only structured fields are selected at all", async () => {
    const { cityId, localityId } = await createLocality();
    const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
    await createOpenReferral(poster, localityId, cityId);
    const viewer = await createTherapist({ role: "physiotherapist", specializations: [], areaId: localityId });

    const feed = await getNetworkActivityFeed(db, viewer);
    for (const item of feed) {
      expect(Object.keys(item)).not.toContain("patientSummary");
    }
  });
});
