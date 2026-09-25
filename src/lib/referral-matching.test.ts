// §8D Step 1 — runs against a real local Postgres, never mocks
// (BUILD_SEQUENCE.md Phase 0's test-stack convention).

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { matchTherapistsForReferral } from "./referral-matching";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdAreaIds: string[] = [];
const createdPracticeIds: string[] = [];

afterEach(async () => {
  let practiceId: string | undefined;
  while ((practiceId = createdPracticeIds.pop()) !== undefined) {
    await client`DELETE FROM practice_users WHERE practice_id = ${practiceId}`;
    await client`DELETE FROM practices WHERE id = ${practiceId}`;
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

async function createCity() {
  const [city] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"Test City " + crypto.randomUUID()}, ${"test-city-" + crypto.randomUUID()}, 'city')
    RETURNING id`;
  await client`UPDATE areas SET city_area_id = ${city.id} WHERE id = ${city.id}`;
  createdAreaIds.push(city.id);
  return city.id as string;
}

async function createZoneAndLocality(cityId?: string) {
  const city = cityId ?? (await createCity());
  const [zone] = await client`
    INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id)
    VALUES (${"Test Zone " + crypto.randomUUID()}, ${"test-zone-" + crypto.randomUUID()}, 'zone', ${city}, ${[city]}, ${city})
    RETURNING id`;
  createdAreaIds.push(zone.id);
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id)
    VALUES (${"Test Locality " + crypto.randomUUID()}, ${"test-locality-" + crypto.randomUUID()}, 'locality', ${zone.id}, ${[city, zone.id]}, ${city})
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return { cityId: city as string, zoneId: zone.id as string, localityId: locality.id as string };
}

// A locality filed directly under its city, no zone — the "proposed with
// no zone chosen" / unzoned shape matchClinicByZoneOrCity falls back to
// same-city for.
async function createUnzonedLocality(cityId?: string) {
  const city = cityId ?? (await createCity());
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id)
    VALUES (${"Test Unzoned Locality " + crypto.randomUUID()}, ${"test-unzoned-locality-" + crypto.randomUUID()}, 'locality', ${city}, ${[city]}, ${city})
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return { cityId: city as string, localityId: locality.id as string };
}

async function createTherapist(opts: {
  role: string;
  specializations: string[];
  acceptingReferrals?: boolean;
  acceptsHomeVisits?: boolean;
  acceptsClinicVisits?: boolean;
  homeVisitAreaId?: string;
  /** Base locality (home_visit_areas.is_primary = true) — distinct from
   * homeVisitAreaId, which is a plain secondary-tier-agnostic coverage
   * row. D2's clinic matching reads only the base, never coverage. */
  baseAreaId?: string;
  profileStatus?: "draft" | "active" | "suspended" | "waitlisted";
  verificationStage?: "unverified" | "qualification_confirmed" | "credentials_verified";
  deleted?: boolean;
}): Promise<string> {
  const email = `therapist-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (
      id, email, account_type, role, specializations,
      accepting_referrals, accepts_home_visits, accepts_clinic_visits,
      profile_status, verification_stage, deleted_at
    ) VALUES (
      ${authUser.id}, ${email}, 'therapist', ${opts.role}, ${opts.specializations},
      ${opts.acceptingReferrals ?? true}, ${opts.acceptsHomeVisits ?? true}, ${opts.acceptsClinicVisits ?? true},
      ${opts.profileStatus ?? "active"}, ${opts.verificationStage ?? "qualification_confirmed"},
      ${opts.deleted ? new Date().toISOString() : null}
    )`;
  createdUserIds.push(authUser.id);
  if (opts.homeVisitAreaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${opts.homeVisitAreaId})`;
  }
  if (opts.baseAreaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id, is_primary) VALUES (${authUser.id}, ${opts.baseAreaId}, true)`;
  }
  return authUser.id;
}

async function createPracticeAt(userId: string, areaId: string): Promise<string> {
  const [practice] = await client`
    INSERT INTO practices (name, type, created_by_user_id, area_id)
    VALUES (${"Test Practice " + crypto.randomUUID()}, 'clinic', ${userId}, ${areaId})
    RETURNING id`;
  createdPracticeIds.push(practice.id);
  await client`
    INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, status, asserted_by)
    VALUES (${practice.id}, ${userId}, 'staff', 'works_at', 'active', 'self')`;
  return practice.id as string;
}

describe("matchTherapistsForReferral — §8D Step 1 targeted notification", () => {
  it("matches a therapist covering the referral's exact locality, on role + specialization + visit type", async () => {
    const { localityId } = await createZoneAndLocality();
    const matchId = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      homeVisitAreaId: localityId,
    });

    const results = await matchTherapistsForReferral(db, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId: localityId,
      homeVisitRequired: true,
    });

    expect(results.map((r) => r.id)).toContain(matchId);
  });

  it("matches a therapist covering the referral's PARENT zone (broader coverage)", async () => {
    const { zoneId, localityId } = await createZoneAndLocality();
    const matchId = await createTherapist({
      role: "physiotherapist",
      specializations: ["neuro_rehab"],
      homeVisitAreaId: zoneId,
    });

    const results = await matchTherapistsForReferral(db, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "neuro_rehab",
      areaId: localityId,
      homeVisitRequired: true,
    });

    expect(results.map((r) => r.id)).toContain(matchId);
  });

  it("excludes a therapist whose specializations don't include the one needed", async () => {
    const { localityId } = await createZoneAndLocality();
    const nonMatchId = await createTherapist({
      role: "physiotherapist",
      specializations: ["neuro_rehab"],
      homeVisitAreaId: localityId,
    });

    const results = await matchTherapistsForReferral(db, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId: localityId,
      homeVisitRequired: true,
    });

    expect(results.map((r) => r.id)).not.toContain(nonMatchId);
  });

  it("excludes a therapist with accepting_referrals = false", async () => {
    const { localityId } = await createZoneAndLocality();
    const nonMatchId = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      acceptingReferrals: false,
      homeVisitAreaId: localityId,
    });

    const results = await matchTherapistsForReferral(db, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId: localityId,
      homeVisitRequired: true,
    });

    expect(results.map((r) => r.id)).not.toContain(nonMatchId);
  });

  it("excludes a therapist who doesn't accept home visits when the referral requires one", async () => {
    const { localityId } = await createZoneAndLocality();
    const nonMatchId = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      acceptsHomeVisits: false,
      homeVisitAreaId: localityId,
    });

    const results = await matchTherapistsForReferral(db, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId: localityId,
      homeVisitRequired: true,
    });

    expect(results.map((r) => r.id)).not.toContain(nonMatchId);
  });

  it("excludes a therapist in an unrelated area", async () => {
    const { localityId } = await createZoneAndLocality();
    const { localityId: otherLocalityId } = await createZoneAndLocality();
    const nonMatchId = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      homeVisitAreaId: otherLocalityId,
    });

    const results = await matchTherapistsForReferral(db, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId: localityId,
      homeVisitRequired: true,
    });

    expect(results.map((r) => r.id)).not.toContain(nonMatchId);
  });

  describe("Round 3 step D (D1) — only therapists who can actually accept", () => {
    it("excludes a draft (not yet finished onboarding) therapist", async () => {
      const { localityId } = await createZoneAndLocality();
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: localityId,
        profileStatus: "draft",
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: localityId,
        homeVisitRequired: true,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("excludes a suspended therapist", async () => {
      const { localityId } = await createZoneAndLocality();
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: localityId,
        profileStatus: "suspended",
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: localityId,
        homeVisitRequired: true,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("excludes a soft-deleted (anonymised) therapist", async () => {
      const { localityId } = await createZoneAndLocality();
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: localityId,
        deleted: true,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: localityId,
        homeVisitRequired: true,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("excludes an unverified therapist", async () => {
      const { localityId } = await createZoneAndLocality();
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: localityId,
        verificationStage: "unverified",
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: localityId,
        homeVisitRequired: true,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("includes a qualification_confirmed therapist — Round 3 decision 1, either verified tier", async () => {
      const { localityId } = await createZoneAndLocality();
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: localityId,
        verificationStage: "qualification_confirmed",
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: localityId,
        homeVisitRequired: true,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });
  });

  describe("city-wide (areaId: null) — review item #1", () => {
    it("matches a therapist whose base locality is in the patient's city, with no home_visit_areas row at all", async () => {
      const { cityId, localityId } = await createZoneAndLocality();
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: localityId,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: null,
        cityAreaId: cityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });

    it("still excludes on role, specialization, accepting_referrals, and clinic-visit acceptance", async () => {
      const { cityId, localityId } = await createZoneAndLocality();
      const wrongRole = await createTherapist({ role: "occupational_therapist", specializations: ["musculoskeletal_orthopaedic"], baseAreaId: localityId });
      const wrongSpecialization = await createTherapist({ role: "physiotherapist", specializations: ["neuro_rehab"], baseAreaId: localityId });
      const notAccepting = await createTherapist({ role: "physiotherapist", specializations: ["musculoskeletal_orthopaedic"], acceptingReferrals: false, baseAreaId: localityId });
      const noClinicVisits = await createTherapist({ role: "physiotherapist", specializations: ["musculoskeletal_orthopaedic"], acceptsClinicVisits: false, baseAreaId: localityId });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: null,
        cityAreaId: cityId,
        homeVisitRequired: false,
      });

      const ids = results.map((r) => r.id);
      expect(ids).not.toContain(wrongRole);
      expect(ids).not.toContain(wrongSpecialization);
      expect(ids).not.toContain(notAccepting);
      expect(ids).not.toContain(noClinicVisits);
    });

    it("Round 3 step D fix — excludes a therapist based in a DIFFERENT city (v1's bug: city-wide matched the whole country)", async () => {
      const { cityId } = await createZoneAndLocality();
      const { localityId: otherCityLocalityId } = await createZoneAndLocality();
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: otherCityLocalityId,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: null,
        cityAreaId: cityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("matches via an active practice in the city when the therapist has no base locality there", async () => {
      const { cityId, localityId } = await createZoneAndLocality();
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
      });
      await createPracticeAt(matchId, localityId);

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: null,
        cityAreaId: cityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });

    it("returns no matches when the caller omits cityAreaId, rather than matching every therapist", async () => {
      const { localityId } = await createZoneAndLocality();
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: localityId,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: null,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).not.toContain(matchId);
    });
  });

  describe("Round 3 step D (D2) — clinic visits match on base/practice location, not home-visit coverage", () => {
    it("excludes a therapist whose only link to the locality is home-visit coverage, not their base or a practice", async () => {
      const { localityId } = await createZoneAndLocality();
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: localityId, // coverage, not base — must not count for a clinic visit
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: localityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("matches a therapist based in the same zone as the referral's locality (a different locality, not the exact one)", async () => {
      const { zoneId, cityId, localityId: referralLocalityId } = await createZoneAndLocality();
      const [otherLocalityInZone] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id)
        VALUES (${"Same Zone Locality " + crypto.randomUUID()}, ${"same-zone-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[cityId, zoneId]}, ${cityId})
        RETURNING id`;
      createdAreaIds.push(otherLocalityInZone.id);
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: otherLocalityInZone.id,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: referralLocalityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });

    it("Round 3 step D review fix — matches a therapist whose base locality is still pending_review (only the zone/city above it are trusted)", async () => {
      const { zoneId, cityId, localityId: referralLocalityId } = await createZoneAndLocality();
      const [pendingLocality] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id, curation_status)
        VALUES (${"Pending Base Locality " + crypto.randomUUID()}, ${"pending-base-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[cityId, zoneId]}, ${cityId}, 'pending_review')
        RETURNING id`;
      createdAreaIds.push(pendingLocality.id);
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: pendingLocality.id,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: referralLocalityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });

    it("still excludes a therapist whose base locality was rejected (isActive = false)", async () => {
      const { zoneId, cityId, localityId: referralLocalityId } = await createZoneAndLocality();
      const [rejectedLocality] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id, curation_status, is_active)
        VALUES (${"Rejected Base Locality " + crypto.randomUUID()}, ${"rejected-base-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[cityId, zoneId]}, ${cityId}, 'approved', false)
        RETURNING id`;
      createdAreaIds.push(rejectedLocality.id);
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: rejectedLocality.id,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: referralLocalityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("excludes a therapist based in a different zone of the same city", async () => {
      const { cityId, localityId } = await createZoneAndLocality();
      const { localityId: otherZoneLocalityId } = await createZoneAndLocality(cityId);
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: otherZoneLocalityId,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: localityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("falls back to same-city when the referral's locality has no zone (unzoned)", async () => {
      const { cityId, localityId: unzonedLocalityId } = await createUnzonedLocality();
      const { localityId: anotherLocalityInCity } = await createZoneAndLocality(cityId);
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        baseAreaId: anotherLocalityInCity,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: unzonedLocalityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });

    it("matches via an active practice in the same zone", async () => {
      const { zoneId, cityId } = await createZoneAndLocality();
      const [practiceLocality] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id)
        VALUES (${"Practice Zone Locality " + crypto.randomUUID()}, ${"practice-zone-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[cityId, zoneId]}, ${cityId})
        RETURNING id`;
      createdAreaIds.push(practiceLocality.id);
      const [referralLocality] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id)
        VALUES (${"Referral Zone Locality " + crypto.randomUUID()}, ${"referral-zone-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[cityId, zoneId]}, ${cityId})
        RETURNING id`;
      createdAreaIds.push(referralLocality.id);
      const referralLocalityId = referralLocality.id as string;

      const matchId = await createTherapist({ role: "physiotherapist", specializations: ["musculoskeletal_orthopaedic"] });
      await createPracticeAt(matchId, practiceLocality.id);

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: referralLocalityId,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });
  });

  describe("Step 5 — pending/rejected areas on the therapist's own coverage (decision 11)", () => {
    it("excludes a therapist whose only home-visit area is still pending_review", async () => {
      const { zoneId, cityId, localityId } = await createZoneAndLocality();
      const [pending] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id, curation_status)
        VALUES (${"Pending Locality " + crypto.randomUUID()}, ${"pending-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[cityId, zoneId]}, ${cityId}, 'pending_review')
        RETURNING id`;
      createdAreaIds.push(pending.id);
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: pending.id,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: localityId,
        homeVisitRequired: true,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("excludes a therapist whose only home-visit area was rejected (isActive = false)", async () => {
      const { zoneId, cityId, localityId } = await createZoneAndLocality();
      const [rejected] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id, curation_status, is_active)
        VALUES (${"Rejected Locality " + crypto.randomUUID()}, ${"rejected-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[cityId, zoneId]}, ${cityId}, 'approved', false)
        RETURNING id`;
      createdAreaIds.push(rejected.id);
      const nonMatchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: rejected.id,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: localityId,
        homeVisitRequired: true,
      });

      expect(results.map((r) => r.id)).not.toContain(nonMatchId);
    });

    it("matches once the area is approved", async () => {
      const { zoneId, cityId } = await createZoneAndLocality();
      const [approved] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, city_area_id, curation_status)
        VALUES (${"Approvable Locality " + crypto.randomUUID()}, ${"approvable-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[cityId, zoneId]}, ${cityId}, 'approved')
        RETURNING id`;
      createdAreaIds.push(approved.id);
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: approved.id,
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: approved.id,
        homeVisitRequired: true,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });
  });
});
