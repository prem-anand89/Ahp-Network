// Runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { openCircleFirstReferrals, sweepLapsedOffers } from "./referral-scheduler";
import { expressInterestTx, postReferralTx, shortlistCandidatesTx } from "./referral-actions";
import { createCircle, addCircleMember } from "./circles";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
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
    await client`DELETE FROM circle_members WHERE therapist_user_id = ${userId}`;
    await client`DELETE FROM circles WHERE owner_user_id = ${userId}`;
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

// Round 3 step E — unlocked by default (see referral-actions.test.ts's
// own createCity for the same reasoning): this file's tests are about
// offer-lapse/First-Look-window mechanics, not city-lock itself.
async function createArea(opts: { unlocked?: boolean } = {}): Promise<string> {
  const [city] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"City " + crypto.randomUUID()}, ${"city-" + crypto.randomUUID()}, 'city')
    RETURNING id`;
  createdAreaIds.push(city.id);
  await client`UPDATE areas SET city_area_id = ${city.id} WHERE id = ${city.id}`;
  if (opts.unlocked ?? true) {
    const adminId = await createAdmin();
    await client`INSERT INTO unlocked_cities (city_area_id, unlocked_by_admin_id) VALUES (${city.id}, ${adminId})`;
  }
  const [area] = await client`
    INSERT INTO areas (name, slug, area_level, city_area_id) VALUES (${"Area " + crypto.randomUUID()}, ${"area-" + crypto.randomUUID()}, 'locality', ${city.id})
    RETURNING id`;
  createdAreaIds.push(area.id);
  return area.id;
}

async function createTherapist(homeVisitAreaId: string): Promise<string> {
  const email = `sched-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, role, specializations, verification_stage, profile_status)
    VALUES (${authUser.id}, ${email}, 'therapist', 'physiotherapist', ${["musculoskeletal_orthopaedic"]}, 'credentials_verified', 'active')`;
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

describe("openCircleFirstReferrals — Phase 5", () => {
  it("extends referral_interest to the rest of the matched pool once the window has passed", async () => {
    const areaId = await createArea();
    const poster = await createTherapist(areaId);
    const inCircle = await createTherapist(areaId);
    const notInCircle = await createTherapist(areaId);
    const { id: circleId } = await createCircle(db, poster, "Inner circle");
    await addCircleMember(db, poster, circleId, inCircle);

    const { referralId } = await postReferralTx(db, poster, {
      roleNeeded: "physiotherapist",
      specializationNeeded: "musculoskeletal_orthopaedic",
      areaId,
      homeVisitRequired: true,
      urgency: "routine",
      patientSummary: "test",
      consentAccepted: true,
      firstLookTarget: { type: "circle", id: circleId },
    });
    createdReferralIds.push(referralId);

    // Not yet due — the window hasn't passed.
    const before = await openCircleFirstReferrals(db);
    expect(before.opened).toBe(0);
    const [{ count: stillNotNotified }] = await client`
      SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referralId} AND therapist_user_id = ${notInCircle}`;
    expect(stillNotNotified).toBe(0);

    // Force the window into the past (0047: the scheduler now compares
    // against circle_first_opens_at, the add_waking_time-computed target
    // open time, not raw created_at + circle_first_window).
    await client`UPDATE home_case_referrals SET circle_first_opens_at = now() - interval '1 hour' WHERE id = ${referralId}`;

    const after = await openCircleFirstReferrals(db);
    expect(after.opened).toBe(1);

    const [{ count: nowNotified }] = await client`
      SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referralId} AND therapist_user_id = ${notInCircle}`;
    expect(nowNotified).toBe(1);

    // The circle member's original row is untouched, not duplicated.
    const [{ count: inCircleRows }] = await client`
      SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referralId} AND therapist_user_id = ${inCircle}`;
    expect(inCircleRows).toBe(1);

    const [{ circle_first_opened_at }] = await client`SELECT circle_first_opened_at FROM home_case_referrals WHERE id = ${referralId}`;
    expect(circle_first_opened_at).not.toBeNull();

    // Idempotent — a second run doesn't re-process an already-opened referral.
    const again = await openCircleFirstReferrals(db);
    expect(again.opened).toBe(0);
  });

  it("does not touch a referral with no circle at all", async () => {
    const areaId = await createArea();
    const poster = await createTherapist(areaId);
    await createTherapist(areaId);

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
    await client`UPDATE home_case_referrals SET created_at = now() - interval '5 hours' WHERE id = ${referralId}`;

    const { opened } = await openCircleFirstReferrals(db);
    expect(opened).toBe(0);
  });

  it("Round 3 step E — defense in depth: never expands into a locked city's pool, even if expand_to_network were somehow true", async () => {
    const areaId = await createArea({ unlocked: false });
    const poster = await createTherapist(areaId);
    const target = await createTherapist(areaId);
    const bystander = await createTherapist(areaId);
    const { id: circleId } = await createCircle(db, poster, "Locked City Defense Circle " + crypto.randomUUID());
    await addCircleMember(db, poster, circleId, target);

    // postReferralTx itself would never produce expand_to_network = true
    // for a locked city with a target — this directly constructs that
    // shape to verify the scheduler's own explicit check catches it too,
    // not just trusts the column.
    const [cityRow] = await client`SELECT city_area_id FROM areas WHERE id = ${areaId}`;
    const [referral] = await client`
      INSERT INTO home_case_referrals
        (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required,
         area_id, city_area_id, patient_consent_recorded_at, initial_circle_id, circle_first_window,
         circle_first_opens_at, expand_to_network)
      VALUES (${poster}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', true,
        ${areaId}, ${cityRow.city_area_id}, now(), ${circleId}, interval '4 hours',
        now() - interval '1 hour', true)
      RETURNING id`;
    createdReferralIds.push(referral.id);

    const { opened } = await openCircleFirstReferrals(db);
    expect(opened).toBe(1); // still marks the window opened...

    const [{ count: bystanderNotified }] = await client`
      SELECT count(*)::int FROM referral_interest WHERE referral_id = ${referral.id} AND therapist_user_id = ${bystander}`;
    expect(bystanderNotified).toBe(0); // ...but never expands to the rest of the (locked) pool.
  });
});
