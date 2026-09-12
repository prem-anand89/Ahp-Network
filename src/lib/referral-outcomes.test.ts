// Runs against a real local Postgres, never mocks — BUILD_SEQUENCE.md
// Phase 0's test-stack convention. Drives referrals to 'accepted' via the
// real postReferralTx/expressInterestTx/shortlistCandidatesTx/acceptOfferTx
// chain (same fixtures as referral-actions.test.ts) rather than hand-
// inserting rows, so eligibility is tested against real state.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { acceptOfferTx, expressInterestTx, postReferralTx, shortlistCandidatesTx } from "./referral-actions";
import {
  closeStaleAcceptedReferrals,
  listLatestOutcomes,
  readReferralOutcomesAsAdminTx,
  reportOutcomeTx,
  sendNudgeTx,
} from "./referral-outcomes";
import { loadAuthzUser } from "./require-session";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdAreaIds: string[] = [];
const createdReferralIds: string[] = [];

afterEach(async () => {
  let referralId: string | undefined;
  while ((referralId = createdReferralIds.pop()) !== undefined) {
    await client`DELETE FROM referral_nudges WHERE referral_id = ${referralId}`;
    await client`DELETE FROM referral_status_updates WHERE referral_id = ${referralId}`;
    await client`DELETE FROM notification_outbox WHERE payload->>'referral_id' = ${referralId}`;
    await client`DELETE FROM referral_events WHERE referral_id = ${referralId}`;
    await client`DELETE FROM referral_interest WHERE referral_id = ${referralId}`;
    await client`DELETE FROM home_case_referrals WHERE id = ${referralId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM audit_logs WHERE actor_user_id = ${userId}`;
    await client`DELETE FROM admin_user_roles WHERE admin_user_id IN (SELECT id FROM admin_users WHERE user_id = ${userId})`;
    await client`DELETE FROM admin_users WHERE user_id = ${userId}`;
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

async function createTherapist(opts: { verificationStage?: string; homeVisitAreaId?: string } = {}): Promise<string> {
  const email = `therapist-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, role, specializations, verification_stage)
    VALUES (
      ${authUser.id}, ${email}, 'therapist', 'physiotherapist',
      ${["musculoskeletal_orthopaedic"]},
      ${opts.verificationStage ?? "credentials_verified"}
    )`;
  createdUserIds.push(authUser.id);
  if (opts.homeVisitAreaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${opts.homeVisitAreaId})`;
  }
  return authUser.id;
}

/** Same admin-fixture pattern as admin-roles.test.ts. */
async function makeReferralOpsAdmin(): Promise<string> {
  const userId = await createTherapist({});
  const [adminUser] = await client`INSERT INTO admin_users (user_id) VALUES (${userId}) RETURNING id`;
  await client`INSERT INTO admin_user_roles (admin_user_id, role) VALUES (${adminUser.id}, 'referral_ops_admin')`;
  return userId;
}

/** Drives a referral all the way to 'accepted' via the real transitions —
 * returns the poster, the accepting therapist, and the referral id. */
async function seedAcceptedReferral() {
  const areaId = await createArea();
  const poster = await createTherapist({ homeVisitAreaId: areaId });
  const therapist = await createTherapist({});

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

describe("reportOutcomeTx (REFERRAL_LOOP_SPEC_ADDENDUM.md §3-§7)", () => {
  it("rejects the poster reporting an outcome (only the accepting therapist may)", async () => {
    const { poster, referralId } = await seedAcceptedReferral();
    await expect(reportOutcomeTx(db, poster, referralId, { outcome: "first_session_done" })).rejects.toThrow(
      /accepted interest/,
    );
  });

  it("rejects a therapist with no interest row at all", async () => {
    const { referralId } = await seedAcceptedReferral();
    const bystander = await createTherapist({});
    await expect(reportOutcomeTx(db, bystander, referralId, { outcome: "first_session_done" })).rejects.toThrow(
      /accepted interest/,
    );
  });

  it("rejects a therapist who has only expressed interest, not been accepted, on a still-open referral", async () => {
    const areaId = await createArea();
    const poster = await createTherapist({ homeVisitAreaId: areaId });
    const therapist = await createTherapist({});
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

    // interestStatus is 'pending', not 'accepted' — denied on that basis
    // before the referral-status ('handover') check is ever reached.
    await expect(reportOutcomeTx(db, therapist, referralId, { outcome: "first_session_done" })).rejects.toThrow(
      /accepted interest/,
    );
  });

  it("accepts an enum-only outcome and records it", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    const { statusUpdateId } = await reportOutcomeTx(db, therapist, referralId, { outcome: "first_session_done" });
    expect(statusUpdateId).toBeTruthy();

    const [row] = await client`SELECT outcome, note FROM referral_status_updates WHERE id = ${statusUpdateId}`;
    expect(row.outcome).toBe("first_session_done");
    expect(row.note).toBeNull();
  });

  it("rejects a note on an outcome that doesn't earn one (no_patient_contact)", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await expect(
      reportOutcomeTx(db, therapist, referralId, { outcome: "no_patient_contact", note: "shouldn't be allowed" }),
    ).rejects.toThrow(/note isn't available/);
  });

  it("rejects discontinued without a reason", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await expect(reportOutcomeTx(db, therapist, referralId, { outcome: "discontinued" })).rejects.toThrow(
      /reason is required/,
    );
  });

  it("rejects a reason on a non-discontinued outcome", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await expect(
      reportOutcomeTx(db, therapist, referralId, { outcome: "ongoing", discontinuedReason: "improved" }),
    ).rejects.toThrow(/only applies to the discontinued outcome/);
  });

  it("rejects a note on discontinued/'improved' (only medical_reason and other earn a note)", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await expect(
      reportOutcomeTx(db, therapist, referralId, {
        outcome: "discontinued",
        discontinuedReason: "improved",
        note: "shouldn't be allowed",
      }),
    ).rejects.toThrow(/note isn't available/);
  });

  it("accepts a note on discontinued/medical_reason", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    const { statusUpdateId } = await reportOutcomeTx(db, therapist, referralId, {
      outcome: "discontinued",
      discontinuedReason: "medical_reason",
      note: "Hospitalised, unrelated to the referred condition",
    });
    const [row] = await client`SELECT note FROM referral_status_updates WHERE id = ${statusUpdateId}`;
    expect(row.note).toBe("Hospitalised, unrelated to the referred condition");
  });

  it("rejects a note over 500 characters", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await expect(
      reportOutcomeTx(db, therapist, referralId, { outcome: "ongoing", note: "x".repeat(501) }),
    ).rejects.toThrow(/500 characters/);
  });

  it("v1-consent regression: a referral posted under consent_text_version 1 accepts enum-only but rejects a note", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await client`UPDATE home_case_referrals SET consent_text_version = '1' WHERE id = ${referralId}`;

    await expect(reportOutcomeTx(db, therapist, referralId, { outcome: "first_session_done" })).resolves.toMatchObject(
      { statusUpdateId: expect.any(String) },
    );
    await expect(
      reportOutcomeTx(db, therapist, referralId, { outcome: "ongoing", note: "any note" }),
    ).rejects.toThrow(/consent text version 2/);
  });

  it("a terminal outcome closes the referral to 'completed', idempotently", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await reportOutcomeTx(db, therapist, referralId, { outcome: "completed_discharged", note: "Discharged, goals met" });

    const [{ status: statusAfterFirst }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(statusAfterFirst).toBe("completed");

    // A second terminal report on an already-completed referral must not
    // throw — the guarded UPDATE just no-ops on its second half.
    await expect(
      reportOutcomeTx(db, therapist, referralId, { outcome: "not_suitable_referred_on", note: "referred elsewhere" }),
    ).resolves.toMatchObject({ statusUpdateId: expect.any(String) });

    const [{ status: statusAfterSecond }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(statusAfterSecond).toBe("completed");
  });

  it("a non-terminal outcome (ongoing) does not close the referral", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await reportOutcomeTx(db, therapist, referralId, { outcome: "ongoing", note: "still going" });
    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(status).toBe("accepted");
  });
});

describe("sendNudgeTx (§5 — asymmetric channel, one canned nudge per 14 days)", () => {
  it("rejects a non-poster sending the nudge", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await expect(sendNudgeTx(db, therapist, referralId)).rejects.toThrow(/poster/);
  });

  it("sends the first nudge, then refuses a second inside 14 days", async () => {
    const { poster, referralId } = await seedAcceptedReferral();
    const first = await sendNudgeTx(db, poster, referralId);
    expect(first.sent).toBe(true);

    const second = await sendNudgeTx(db, poster, referralId);
    expect(second.sent).toBe(false);
  });

  it("allows a new nudge once the prior one is more than 14 days old", async () => {
    const { poster, referralId } = await seedAcceptedReferral();
    await sendNudgeTx(db, poster, referralId);
    await client`UPDATE referral_nudges SET created_at = now() - interval '15 days' WHERE referral_id = ${referralId}`;

    const result = await sendNudgeTx(db, poster, referralId);
    expect(result.sent).toBe(true);
  });

  it("rejects a nudge on a referral that hasn't reached handover", async () => {
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
    });
    createdReferralIds.push(referralId);

    await expect(sendNudgeTx(db, poster, referralId)).rejects.toThrow(/handover/);
  });
});

describe("readReferralOutcomesAsAdminTx (§7 — admin reads are always audited)", () => {
  it("rejects a non-admin therapist", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await reportOutcomeTx(db, therapist, referralId, { outcome: "first_session_done" });

    const authzUser = await loadAuthzUser(db, therapist);
    await expect(readReferralOutcomesAsAdminTx(db, authzUser, referralId)).rejects.toThrow(
      /referral_ops_admin or super_admin/,
    );
  });

  it("lets a referral_ops_admin read the timeline and writes an audit_logs row", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await reportOutcomeTx(db, therapist, referralId, { outcome: "first_session_done" });

    const adminUserId = await makeReferralOpsAdmin();
    const authzUser = await loadAuthzUser(db, adminUserId);

    const rows = await readReferralOutcomesAsAdminTx(db, authzUser, referralId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("first_session_done");

    const auditRows = await client`
      SELECT action, target_table, target_id FROM audit_logs
      WHERE actor_user_id = ${adminUserId} AND action = 'referral_outcomes_read'`;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].target_table).toBe("referral_status_updates");
    expect(auditRows[0].target_id).toBe(referralId);
  });
});

describe("listLatestOutcomes (§10 — board list's latest-outcome-per-referral)", () => {
  it("returns only the most recent outcome per referral, and omits referrals with none", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    const { referralId: referralIdNoOutcome } = await seedAcceptedReferral();

    await reportOutcomeTx(db, therapist, referralId, { outcome: "first_session_done" });
    await reportOutcomeTx(db, therapist, referralId, { outcome: "ongoing", note: "still going" });

    const latest = await listLatestOutcomes(db, [referralId, referralIdNoOutcome]);
    expect(latest.get(referralId)?.outcome).toBe("ongoing");
    expect(latest.has(referralIdNoOutcome)).toBe(false);
  });

  it("returns an empty map for an empty input", async () => {
    const latest = await listLatestOutcomes(db, []);
    expect(latest.size).toBe(0);
  });
});

describe("closeStaleAcceptedReferrals (execution-plan §Phase 3 — the 45-day backstop)", () => {
  it("auto-closes an 'accepted' referral past 45 days with zero status updates", async () => {
    const { referralId } = await seedAcceptedReferral();
    await client`UPDATE home_case_referrals SET accepted_at = now() - interval '46 days' WHERE id = ${referralId}`;

    const closed = await closeStaleAcceptedReferrals(db);
    expect(closed).toBeGreaterThanOrEqual(1);

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(status).toBe("auto_closed");
  });

  it("never touches a stale 'accepted' referral that already has a status update", async () => {
    const { therapist, referralId } = await seedAcceptedReferral();
    await reportOutcomeTx(db, therapist, referralId, { outcome: "ongoing", note: "still going" });
    await client`UPDATE home_case_referrals SET accepted_at = now() - interval '46 days' WHERE id = ${referralId}`;

    await closeStaleAcceptedReferrals(db);

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(status).toBe("accepted");
  });

  it("leaves an 'accepted' referral under 45 days untouched", async () => {
    const { referralId } = await seedAcceptedReferral();

    await closeStaleAcceptedReferrals(db);

    const [{ status }] = await client`SELECT status FROM home_case_referrals WHERE id = ${referralId}`;
    expect(status).toBe("accepted");
  });
});
