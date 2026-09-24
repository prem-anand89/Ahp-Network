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

async function createZoneAndLocality() {
  const [zone] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"Test Zone " + crypto.randomUUID()}, ${"test-zone-" + crypto.randomUUID()}, 'zone')
    RETURNING id`;
  createdAreaIds.push(zone.id);
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids)
    VALUES (${"Test Locality " + crypto.randomUUID()}, ${"test-locality-" + crypto.randomUUID()}, 'locality', ${zone.id}, ${[zone.id]})
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return { zoneId: zone.id as string, localityId: locality.id as string };
}

async function createTherapist(opts: {
  role: string;
  specializations: string[];
  acceptingReferrals?: boolean;
  acceptsHomeVisits?: boolean;
  acceptsClinicVisits?: boolean;
  homeVisitAreaId?: string;
}): Promise<string> {
  const email = `therapist-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (
      id, email, account_type, role, specializations,
      accepting_referrals, accepts_home_visits, accepts_clinic_visits
    ) VALUES (
      ${authUser.id}, ${email}, 'therapist', ${opts.role}, ${opts.specializations},
      ${opts.acceptingReferrals ?? true}, ${opts.acceptsHomeVisits ?? true}, ${opts.acceptsClinicVisits ?? true}
    )`;
  createdUserIds.push(authUser.id);
  if (opts.homeVisitAreaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${opts.homeVisitAreaId})`;
  }
  return authUser.id;
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

  describe("city-wide (areaId: null) — review item #1", () => {
    it("matches a therapist who accepts clinic visits, with no home_visit_areas row at all", async () => {
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        // Deliberately no homeVisitAreaId — city-wide matching must not
        // require one; clinic-visit eligibility doesn't depend on a
        // therapist's home-visit service area.
      });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: null,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });

    it("still excludes on role, specialization, accepting_referrals, and clinic-visit acceptance", async () => {
      const wrongRole = await createTherapist({ role: "occupational_therapist", specializations: ["musculoskeletal_orthopaedic"] });
      const wrongSpecialization = await createTherapist({ role: "physiotherapist", specializations: ["neuro_rehab"] });
      const notAccepting = await createTherapist({ role: "physiotherapist", specializations: ["musculoskeletal_orthopaedic"], acceptingReferrals: false });
      const noClinicVisits = await createTherapist({ role: "physiotherapist", specializations: ["musculoskeletal_orthopaedic"], acceptsClinicVisits: false });

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: null,
        homeVisitRequired: false,
      });

      const ids = results.map((r) => r.id);
      expect(ids).not.toContain(wrongRole);
      expect(ids).not.toContain(wrongSpecialization);
      expect(ids).not.toContain(notAccepting);
      expect(ids).not.toContain(noClinicVisits);
    });

    it("a therapist far from the poster's own locality still matches — that's the whole point", async () => {
      const { localityId } = await createZoneAndLocality();
      const { localityId: farAwayLocalityId } = await createZoneAndLocality();
      const matchId = await createTherapist({
        role: "physiotherapist",
        specializations: ["musculoskeletal_orthopaedic"],
        homeVisitAreaId: farAwayLocalityId,
      });
      void localityId;

      const results = await matchTherapistsForReferral(db, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId: null,
        homeVisitRequired: false,
      });

      expect(results.map((r) => r.id)).toContain(matchId);
    });
  });

  describe("Step 5 — pending/rejected areas (decision 11)", () => {
    it("excludes a therapist whose only home-visit area is still pending_review", async () => {
      const { zoneId, localityId } = await createZoneAndLocality();
      const [pending] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, curation_status)
        VALUES (${"Pending Locality " + crypto.randomUUID()}, ${"pending-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[zoneId]}, 'pending_review')
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
      const { zoneId, localityId } = await createZoneAndLocality();
      const [rejected] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, curation_status, is_active)
        VALUES (${"Rejected Locality " + crypto.randomUUID()}, ${"rejected-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[zoneId]}, 'approved', false)
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
      const { zoneId } = await createZoneAndLocality();
      const [approved] = await client`
        INSERT INTO areas (name, slug, area_level, parent_id, ancestor_ids, curation_status)
        VALUES (${"Approvable Locality " + crypto.randomUUID()}, ${"approvable-locality-" + crypto.randomUUID()}, 'locality', ${zoneId}, ${[zoneId]}, 'approved')
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
