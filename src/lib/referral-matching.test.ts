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
});
