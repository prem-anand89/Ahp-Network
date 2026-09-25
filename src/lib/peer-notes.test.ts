// Phase 5 — peer notes. Same real-Postgres, real-transition-chain fixture
// pattern as case-brief.test.ts, extended one step further: a peer note
// requires the referral to have actually completed, not just accepted.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { acceptOfferTx, expressInterestTx, postReferralTx, shortlistCandidatesTx } from "./referral-actions";
import { reportOutcomeTx } from "./referral-outcomes";
import {
  writePeerNoteTx,
  editPeerNoteTx,
  hidePeerNoteTx,
  listPeerNotesForProfile,
  getMyPeerNoteForReferral,
} from "./peer-notes";

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
    await client`DELETE FROM peer_notes WHERE referral_id = ${referralId}`;
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

async function seedAcceptedReferral() {
  const areaId = await createArea();
  const poster = await createTherapist({ homeVisitAreaId: areaId, displayName: "Poster Therapist" });
  const therapist = await createTherapist({ homeVisitAreaId: areaId, displayName: "Accepting Therapist" });

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

async function seedCompletedReferral() {
  const { poster, therapist, referralId } = await seedAcceptedReferral();
  await reportOutcomeTx(db, therapist, referralId, { outcome: "completed_discharged" });
  return { poster, therapist, referralId };
}

const NOTE_BODY = "Clear handoff, easy to reach, patient was well looked after.";

describe("writePeerNoteTx", () => {
  it("lets the poster write a note about the accepting therapist once completed", async () => {
    const { poster, therapist, referralId } = await seedCompletedReferral();
    const { id } = await writePeerNoteTx(db, poster, referralId, NOTE_BODY);

    const [row] = await client`SELECT subject_user_id, author_user_id, body FROM peer_notes WHERE id = ${id}`;
    expect(row.subject_user_id).toBe(therapist);
    expect(row.author_user_id).toBe(poster);
    expect(row.body).toBe(NOTE_BODY);
  });

  it("lets the accepting therapist write a note about the poster once completed", async () => {
    const { poster, therapist, referralId } = await seedCompletedReferral();
    const { id } = await writePeerNoteTx(db, therapist, referralId, NOTE_BODY);

    const [row] = await client`SELECT subject_user_id, author_user_id FROM peer_notes WHERE id = ${id}`;
    expect(row.subject_user_id).toBe(poster);
    expect(row.author_user_id).toBe(therapist);
  });

  it("rejects a bystander with no relationship to the referral", async () => {
    const { referralId } = await seedCompletedReferral();
    const bystander = await createTherapist({});
    await expect(writePeerNoteTx(db, bystander, referralId, NOTE_BODY)).rejects.toThrow(/only the referral's poster or accepted therapist/);
  });

  it("rejects writing before the referral has actually completed (merely accepted)", async () => {
    const { poster, referralId } = await seedAcceptedReferral();
    await expect(writePeerNoteTx(db, poster, referralId, NOTE_BODY)).rejects.toThrow(/actually completed/);
  });

  it("rejects a second note from the same author for the same referral", async () => {
    const { poster, referralId } = await seedCompletedReferral();
    await writePeerNoteTx(db, poster, referralId, NOTE_BODY);
    await expect(writePeerNoteTx(db, poster, referralId, "a second note")).rejects.toThrow(/already written/);
  });

  it("rejects a note over 240 characters", async () => {
    const { poster, referralId } = await seedCompletedReferral();
    await expect(writePeerNoteTx(db, poster, referralId, "x".repeat(241))).rejects.toThrow(/240 characters or fewer/);
  });

  it("rejects a blank note", async () => {
    const { poster, referralId } = await seedCompletedReferral();
    await expect(writePeerNoteTx(db, poster, referralId, "   ")).rejects.toThrow(/can't be empty/);
  });
});

describe("editPeerNoteTx", () => {
  it("lets the author edit within the 24-hour window", async () => {
    const { poster, referralId } = await seedCompletedReferral();
    const { id } = await writePeerNoteTx(db, poster, referralId, NOTE_BODY);
    await editPeerNoteTx(db, poster, id, "Updated note text.");

    const [row] = await client`SELECT body FROM peer_notes WHERE id = ${id}`;
    expect(row.body).toBe("Updated note text.");
  });

  it("rejects an edit from someone other than the author", async () => {
    const { poster, therapist, referralId } = await seedCompletedReferral();
    const { id } = await writePeerNoteTx(db, poster, referralId, NOTE_BODY);
    await expect(editPeerNoteTx(db, therapist, id, "hijack")).rejects.toThrow(/only the note's author/);
  });

  it("rejects an edit after the 24-hour window", async () => {
    const { poster, referralId } = await seedCompletedReferral();
    const { id } = await writePeerNoteTx(db, poster, referralId, NOTE_BODY);
    await client`UPDATE peer_notes SET created_at = now() - interval '25 hours' WHERE id = ${id}`;
    await expect(editPeerNoteTx(db, poster, id, "too late")).rejects.toThrow(/24-hour edit window/);
  });
});

describe("hidePeerNoteTx", () => {
  it("lets the subject hide a note about them", async () => {
    const { poster, therapist, referralId } = await seedCompletedReferral();
    const { id } = await writePeerNoteTx(db, poster, referralId, NOTE_BODY);
    await hidePeerNoteTx(db, therapist, id);

    const [row] = await client`SELECT status FROM peer_notes WHERE id = ${id}`;
    expect(row.status).toBe("hidden_by_subject");
  });

  it("rejects the author trying to hide their own note — subject only", async () => {
    const { poster, referralId } = await seedCompletedReferral();
    const { id } = await writePeerNoteTx(db, poster, referralId, NOTE_BODY);
    await expect(hidePeerNoteTx(db, poster, id)).rejects.toThrow(/only the note's subject/);
  });
});

describe("listPeerNotesForProfile", () => {
  it("caps at two notes by recency, never returning a count/total", async () => {
    const areaId = await createArea();
    const subject = await createTherapist({ homeVisitAreaId: areaId, displayName: "Popular Therapist" });

    for (let i = 0; i < 3; i++) {
      const author = await createTherapist({ homeVisitAreaId: areaId });
      const { referralId } = await postReferralTx(db, subject, {
        roleNeeded: "physiotherapist",
        specializationNeeded: "musculoskeletal_orthopaedic",
        areaId,
        homeVisitRequired: true,
        urgency: "routine",
        patientSummary: "case " + i,
        consentAccepted: true,
      });
      createdReferralIds.push(referralId);
      const { interestId } = await expressInterestTx(db, author, referralId);
      await shortlistCandidatesTx(db, subject, referralId, [author]);
      await acceptOfferTx(db, author, referralId, interestId, crypto.randomUUID());
      await reportOutcomeTx(db, author, referralId, { outcome: "completed_discharged" });
      await writePeerNoteTx(db, author, referralId, `note ${i}`);
    }

    const notes = await listPeerNotesForProfile(db, subject);
    expect(notes).toHaveLength(2);
  });

  it("excludes hidden and removed notes", async () => {
    const { poster, therapist, referralId } = await seedCompletedReferral();
    const { id } = await writePeerNoteTx(db, poster, referralId, NOTE_BODY);
    await hidePeerNoteTx(db, therapist, id);

    const notes = await listPeerNotesForProfile(db, therapist);
    expect(notes).toHaveLength(0);
  });
});

describe("getMyPeerNoteForReferral", () => {
  it("finds the author's own note, including a hidden one", async () => {
    const { poster, therapist, referralId } = await seedCompletedReferral();
    const { id } = await writePeerNoteTx(db, poster, referralId, NOTE_BODY);
    await hidePeerNoteTx(db, therapist, id);

    const mine = await getMyPeerNoteForReferral(db, poster, referralId);
    expect(mine?.id).toBe(id);
    expect(mine?.status).toBe("hidden_by_subject");
  });

  it("returns null when the author hasn't written one", async () => {
    const { poster, referralId } = await seedCompletedReferral();
    const mine = await getMyPeerNoteForReferral(db, poster, referralId);
    expect(mine).toBeNull();
  });
});
