// Runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { sweepLapsedOffers } from "./referral-scheduler";
import { expressInterestTx, postReferralTx, shortlistCandidatesTx } from "./referral-actions";

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
    await client`DELETE FROM notification_outbox WHERE payload->>'referral_id' = ${referralId}`;
    await client`DELETE FROM referral_events WHERE referral_id = ${referralId}`;
    await client`DELETE FROM referral_interest WHERE referral_id = ${referralId}`;
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

async function createArea(): Promise<string> {
  const [area] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"Area " + crypto.randomUUID()}, ${"area-" + crypto.randomUUID()}, 'locality')
    RETURNING id`;
  createdAreaIds.push(area.id);
  return area.id;
}

async function createTherapist(homeVisitAreaId: string): Promise<string> {
  const email = `sched-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, role, specializations, verification_stage)
    VALUES (${authUser.id}, ${email}, 'therapist', 'physiotherapist', ${["musculoskeletal_orthopaedic"]}, 'credentials_verified')`;
  createdUserIds.push(authUser.id);
  await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${homeVisitAreaId})`;
  return authUser.id;
}

describe("sweepLapsedOffers — §8D deadline scheduler", () => {
  it("reopens a referral whose only shortlisted offer is past its expiry", async () => {
    const areaId = await createArea();
    const poster = await createTherapist(areaId);
    const therapist = await createTherapist(areaId);

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

    await expressInterestTx(db, therapist, referralId);
    // Zero-second offer window — already due by the time the sweep runs.
    await shortlistCandidatesTx(db, poster, referralId, [therapist]);
    await client`UPDATE home_case_referrals SET offer_expires_at = now() - interval '1 minute' WHERE id = ${referralId}`;

    const { swept } = await sweepLapsedOffers(db);
    expect(swept).toBeGreaterThanOrEqual(1);

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(status).toBe("open");

    const [{ status: interestStatus }] = await client`
      SELECT status FROM referral_interest WHERE referral_id = ${referralId} AND therapist_user_id = ${therapist}`;
    expect(interestStatus).toBe("missed");
  });

  it("does not touch a referral whose offer hasn't expired yet", async () => {
    const areaId = await createArea();
    const poster = await createTherapist(areaId);
    const therapist = await createTherapist(areaId);

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

    await expressInterestTx(db, therapist, referralId);
    await shortlistCandidatesTx(db, poster, referralId, [therapist]); // default 4h window, not due

    await sweepLapsedOffers(db);

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(status).toBe("shortlisted");
  });
});
