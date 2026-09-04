// Runs against a real local Postgres, never mocks — BUILD_SEQUENCE.md
// Phase 0's test-stack convention. Tested against postReferralTx etc.
// directly, not the server action wrapper, since the wrapper only
// resolves auth (same pattern as practice-claims.test.ts).

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  acceptOfferTx,
  declineOfferTx,
  expressInterestTx,
  postReferralTx,
  shortlistCandidatesTx,
} from "./referral-actions";

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

async function createArea(): Promise<string> {
  const [area] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"Area " + crypto.randomUUID()}, ${"area-" + crypto.randomUUID()}, 'locality')
    RETURNING id`;
  createdAreaIds.push(area.id);
  return area.id;
}

async function createTherapist(opts: {
  verificationStage?: string;
  homeVisitAreaId?: string;
  specializations?: string[];
}): Promise<string> {
  const email = `therapist-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, role, specializations, verification_stage)
    VALUES (
      ${authUser.id}, ${email}, 'therapist', 'physiotherapist',
      ${opts.specializations ?? ["musculoskeletal_orthopaedic"]},
      ${opts.verificationStage ?? "credentials_verified"}
    )`;
  createdUserIds.push(authUser.id);
  if (opts.homeVisitAreaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${opts.homeVisitAreaId})`;
  }
  return authUser.id;
}

describe("postReferralTx (§8D, §8D2)", () => {
  it("rejects a post without consent accepted", async () => {
    const areaId = await createArea();
    const poster = await createTherapist({ homeVisitAreaId: areaId });
    await expect(
      postReferralTx(db, poster, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId,
        homeVisitRequired: true,
        urgency: "routine",
        patientSummary: "65M, s/p knee replacement",
        consentAccepted: false,
      }),
    ).rejects.toThrow(/consent/i);
  });

  it("rejects an urgent referral with no urgency reason", async () => {
    const areaId = await createArea();
    const poster = await createTherapist({ homeVisitAreaId: areaId });
    await expect(
      postReferralTx(db, poster, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId,
        homeVisitRequired: true,
        urgency: "urgent",
        patientSummary: "65M, s/p knee replacement",
        consentAccepted: true,
      }),
    ).rejects.toThrow(/urgency reason/i);
  });

  it("posts a referral, matches the pool, and enqueues notifications", async () => {
    const areaId = await createArea();
    const poster = await createTherapist({ homeVisitAreaId: areaId });
    const matched = await createTherapist({ homeVisitAreaId: areaId });

    const result = await postReferralTx(db, poster, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId,
      homeVisitRequired: true,
      urgency: "routine",
      patientSummary: "65M, s/p knee replacement",
      consentAccepted: true,
    });
    createdReferralIds.push(result.referralId);

    expect(result.matchedPoolSize).toBe(1);

    const [{ count: interestCount }] = await client`
      SELECT count(*)::int FROM referral_interest
      WHERE referral_id = ${result.referralId} AND therapist_user_id = ${matched}`;
    expect(interestCount).toBe(1);

    const [{ count: outboxCount }] = await client`
      SELECT count(*)::int FROM notification_outbox WHERE user_id = ${matched}`;
    expect(outboxCount).toBe(1);
  });
});

describe("expressInterestTx / shortlistCandidatesTx / acceptOfferTx / declineOfferTx", () => {
  async function seedOpenReferral() {
    const areaId = await createArea();
    const poster = await createTherapist({ homeVisitAreaId: areaId });
    const { referralId } = await postReferralTx(db, poster, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId,
      homeVisitRequired: true,
      urgency: "routine",
      patientSummary: "test",
      consentAccepted: true,
    }).then((r) => {
      createdReferralIds.push(r.referralId);
      return { referralId: r.referralId };
    });
    return { poster, referralId, areaId };
  }

  it("blocks a qualification_confirmed (not credentials_verified) therapist from expressing interest", async () => {
    const { referralId } = await seedOpenReferral();
    const unverified = await createTherapist({ verificationStage: "qualification_confirmed" });
    await expect(expressInterestTx(db, unverified, referralId)).rejects.toThrow(/credentials_verified/);
  });

  it("full happy path: interest -> shortlist -> accept", async () => {
    const { poster, referralId } = await seedOpenReferral();
    const therapist = await createTherapist({});

    const { interestId } = await expressInterestTx(db, therapist, referralId);
    await shortlistCandidatesTx(db, poster, referralId, [therapist]);

    const result = (await acceptOfferTx(db, therapist, referralId, interestId, crypto.randomUUID())) as {
      accepted_by: string;
    };
    expect(result.accepted_by).toBe(therapist);

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(status).toBe("accepted");
  });

  it("maps a lost accept race to the §8D user-facing message", async () => {
    const { poster, referralId } = await seedOpenReferral();
    const t1 = await createTherapist({});
    const t2 = await createTherapist({});
    const { interestId: i1 } = await expressInterestTx(db, t1, referralId);
    const { interestId: i2 } = await expressInterestTx(db, t2, referralId);
    await shortlistCandidatesTx(db, poster, referralId, [t1, t2]);

    await acceptOfferTx(db, t1, referralId, i1, crypto.randomUUID());
    await expect(acceptOfferTx(db, t2, referralId, i2, crypto.randomUUID())).rejects.toThrow(
      "Went to someone else.",
    );
  });

  it("declineOfferTx marks a pending interest declined, distinct from missed", async () => {
    const { referralId } = await seedOpenReferral();
    const therapist = await createTherapist({});
    const { interestId } = await expressInterestTx(db, therapist, referralId);

    await declineOfferTx(db, therapist, referralId, interestId);

    const [{ status }] = await client`SELECT status FROM referral_interest WHERE id = ${interestId}`;
    expect(status).toBe("declined");
  });
});
