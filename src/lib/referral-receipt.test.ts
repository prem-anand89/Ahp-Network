// Phase 5 — the referral receipt. Same real-Postgres, real-transition-
// chain fixture pattern as case-brief.test.ts/peer-notes.test.ts.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { acceptOfferTx, expressInterestTx, postReferralTx, shortlistCandidatesTx } from "./referral-actions";
import { reportOutcomeTx } from "./referral-outcomes";
import { getReceiptByCode } from "./referral-receipt";

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
    await client`DELETE FROM referral_status_updates WHERE referral_id = ${referralId}`;
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

async function createArea(name: string): Promise<string> {
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
    INSERT INTO areas (name, slug, area_level, city_area_id) VALUES (${name}, ${"area-" + crypto.randomUUID()}, 'locality', ${city.id})
    RETURNING id`;
  createdAreaIds.push(area.id);
  return area.id;
}

async function createTherapist(opts: { homeVisitAreaId?: string; displayName?: string } = {}): Promise<string> {
  const email = `therapist-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, display_name, role, specializations, verification_stage, profile_status)
    VALUES (${authUser.id}, ${email}, 'therapist', ${opts.displayName ?? email}, 'physiotherapist', ${["musculoskeletal_orthopaedic"]}, 'credentials_verified', 'active')`;
  createdUserIds.push(authUser.id);
  if (opts.homeVisitAreaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${opts.homeVisitAreaId})`;
  }
  return authUser.id;
}

describe("getReceiptByCode", () => {
  it("returns the full receipt for a completed referral's code", async () => {
    const areaId = await createArea("Receipt Test Locality");
    const poster = await createTherapist({ homeVisitAreaId: areaId, displayName: "Poster One" });
    const therapist = await createTherapist({ homeVisitAreaId: areaId, displayName: "Accepter One" });

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
    await reportOutcomeTx(db, therapist, referralId, { outcome: "completed_discharged" });

    const [{ public_ref_code: code }] = await client`SELECT public_ref_code FROM home_case_referrals WHERE id = ${referralId}`;

    const receipt = await getReceiptByCode(db, code);
    expect(receipt?.publicRefCode).toBe(code);
    expect(receipt?.posterDisplayName).toBe("Poster One");
    expect(receipt?.accepterDisplayName).toBe("Accepter One");
    expect(receipt?.localityName).toBe("Receipt Test Locality");
    expect(receipt?.specializationNeeded).toBe("musculoskeletal_orthopaedic");
    expect(receipt?.outcome).toBe("completed_discharged");
  });

  it("returns null for an unknown code", async () => {
    const receipt = await getReceiptByCode(db, "R-2099-9999");
    expect(receipt).toBeNull();
  });

  it("returns null for a referral that hasn't completed yet (no code exists)", async () => {
    const areaId = await createArea("Not Completed Locality");
    const poster = await createTherapist({ homeVisitAreaId: areaId });
    const { referralId } = await postReferralTx(db, poster, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId,
      homeVisitRequired: true,
      urgency: "routine",
      patientSummary: "test",
      consentAccepted: true,
    });
    createdReferralIds.push(referralId);

    const receipt = await getReceiptByCode(db, "R-2026-0001");
    expect(receipt).toBeNull();
  });
});
