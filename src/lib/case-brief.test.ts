// Phase 4 — the case brief. Same real-Postgres, real-transition-chain
// fixture pattern as referral-outcomes.test.ts (seedAcceptedReferral
// drives open -> accepted via the actual postReferralTx/expressInterestTx/
// shortlistCandidatesTx/acceptOfferTx functions, never hand-inserted
// status values).

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { acceptOfferTx, expressInterestTx, postReferralTx, shortlistCandidatesTx } from "./referral-actions";
import { writeCaseBriefTx, canViewCaseBrief, type CaseBriefInput } from "./case-brief";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdAreaIds: string[] = [];
const createdReferralIds: string[] = [];
const createdAdminUserIds: string[] = [];

afterEach(async () => {
  let referralId: string | undefined;
  while ((referralId = createdReferralIds.pop()) !== undefined) {
    await client`DELETE FROM notification_outbox WHERE payload->>'referral_id' = ${referralId}`;
    await client`DELETE FROM referral_events WHERE referral_id = ${referralId}`;
    await client`DELETE FROM referral_interest WHERE referral_id = ${referralId}`;
    await client`DELETE FROM home_case_referrals WHERE id = ${referralId}`;
  }
  // Round 3 step E — cleared before admin_users below (unlocked_cities'
  // FK to it), and before the areaId loop's own area deletes.
  if (createdAreaIds.length > 0) {
    await client`DELETE FROM unlocked_cities WHERE city_area_id = ANY(${createdAreaIds})`;
  }
  let adminUserId: string | undefined;
  while ((adminUserId = createdAdminUserIds.pop()) !== undefined) {
    await client`DELETE FROM admin_users WHERE id = ${adminUserId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM idempotency_keys WHERE user_id = ${userId}`;
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

async function createAdmin(): Promise<string> {
  const email = `admin-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type, profile_status) VALUES (${authUser.id}, ${email}, 'therapist', 'active')`;
  createdUserIds.push(authUser.id);
  const [admin] = await client`INSERT INTO admin_users (user_id) VALUES (${authUser.id}) RETURNING id`;
  createdAdminUserIds.push(admin.id);
  return admin.id;
}

async function createArea(): Promise<string> {
  const [city] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"City " + crypto.randomUUID()}, ${"city-" + crypto.randomUUID()}, 'city')
    RETURNING id`;
  createdAreaIds.push(city.id);
  await client`UPDATE areas SET city_area_id = ${city.id} WHERE id = ${city.id}`;
  // Round 3 step E — unlocked by default; these tests are about
  // unrelated referral-engine mechanics, not city-lock itself.
  const adminId = await createAdmin();
  await client`INSERT INTO unlocked_cities (city_area_id, unlocked_by_admin_id) VALUES (${city.id}, ${adminId})`;
  const [area] = await client`
    INSERT INTO areas (name, slug, area_level, city_area_id) VALUES (${"Area " + crypto.randomUUID()}, ${"area-" + crypto.randomUUID()}, 'locality', ${city.id})
    RETURNING id`;
  createdAreaIds.push(area.id);
  return area.id;
}

async function createTherapist(opts: { homeVisitAreaId?: string } = {}): Promise<string> {
  const email = `therapist-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, role, specializations, verification_stage, profile_status)
    VALUES (${authUser.id}, ${email}, 'therapist', 'physiotherapist', ${["musculoskeletal_orthopaedic"]}, 'credentials_verified', 'active')`;
  createdUserIds.push(authUser.id);
  if (opts.homeVisitAreaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${opts.homeVisitAreaId})`;
  }
  return authUser.id;
}

async function seedAcceptedReferral() {
  const areaId = await createArea();
  const poster = await createTherapist({ homeVisitAreaId: areaId });
  const therapist = await createTherapist({ homeVisitAreaId: areaId });

  const { referralId } = await postReferralTx(db, poster, {
    roleNeeded: "physiotherapist",
    specializationNeeded: "musculoskeletal_orthopaedic",
    areaId,
    homeVisitRequired: true,
    urgency: "routine",
    patientSummary: "65M, s/p knee replacement",
    consentAccepted: true,
  });
  createdReferralIds.push(referralId);

  const { interestId } = await expressInterestTx(db, therapist, referralId);
  await shortlistCandidatesTx(db, poster, referralId, [therapist]);
  await acceptOfferTx(db, therapist, referralId, interestId, crypto.randomUUID());

  return { poster, therapist, referralId };
}

const VALID_INPUT: CaseBriefInput = {
  reasonForReferral: "Post-op knee rehab",
  relevantHistory: "s/p TKR 3 weeks ago, otherwise healthy",
  precautions: "Weight-bearing as tolerated, avoid high-impact",
  preferredContactWindow: "Weekday mornings before 11am",
};

describe("writeCaseBriefTx", () => {
  it("lets the poster write a case brief once the referral is accepted", async () => {
    const { poster, referralId } = await seedAcceptedReferral();
    await writeCaseBriefTx(db, poster, referralId, VALID_INPUT);

    const [row] = await client`SELECT case_brief, case_brief_written_at FROM home_case_referrals WHERE id = ${referralId}`;
    expect(row.case_brief).toEqual(VALID_INPUT);
    expect(row.case_brief_written_at).not.toBeNull();
  });

  it("rejects the accepting therapist writing the brief — poster only", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await expect(writeCaseBriefTx(db, therapist, referralId, VALID_INPUT)).rejects.toThrow(/poster/);
  });

  it("rejects a second write — write-once", async () => {
    const { poster, referralId } = await seedAcceptedReferral();
    await writeCaseBriefTx(db, poster, referralId, VALID_INPUT);
    await expect(writeCaseBriefTx(db, poster, referralId, VALID_INPUT)).rejects.toThrow(/already been written/);
  });

  it("rejects writing before acceptance (still open, or only shortlisted)", async () => {
    const areaId = await createArea();
    const poster = await createTherapist({ homeVisitAreaId: areaId });
    const { referralId } = await postReferralTx(db, poster, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId,
      homeVisitRequired: true,
      urgency: "routine",
      patientSummary: "65M, s/p knee replacement",
      consentAccepted: true,
    });
    createdReferralIds.push(referralId);

    await expect(writeCaseBriefTx(db, poster, referralId, VALID_INPUT)).rejects.toThrow(/accepted/);
  });

  it("rejects a blank required field", async () => {
    const { poster, referralId } = await seedAcceptedReferral();
    await expect(
      writeCaseBriefTx(db, poster, referralId, { ...VALID_INPUT, precautions: "   " }),
    ).rejects.toThrow(/Precautions is required/);
  });

  it("rejects a field over the length cap", async () => {
    const { poster, referralId } = await seedAcceptedReferral();
    await expect(
      writeCaseBriefTx(db, poster, referralId, { ...VALID_INPUT, relevantHistory: "x".repeat(301) }),
    ).rejects.toThrow(/300 characters or fewer/);
  });
});

describe("canViewCaseBrief", () => {
  it("the poster and the accepter can both view it; nobody else can", () => {
    expect(canViewCaseBrief(true, false)).toBe(true);
    expect(canViewCaseBrief(false, true)).toBe(true);
    expect(canViewCaseBrief(false, false)).toBe(false);
  });
});
