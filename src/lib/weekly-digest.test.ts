// §10H — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { buildWeeklyDigestSummary, digestMessage, enqueueWeeklyDigests } from "./weekly-digest";

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
    await client`DELETE FROM home_case_referrals WHERE id = ${referralId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM notification_outbox WHERE user_id = ${userId}`;
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

async function createLocality(ancestorIds: string[] = []): Promise<string> {
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, ancestor_ids)
    VALUES (${"Test Locality " + crypto.randomUUID()}, ${"test-locality-" + crypto.randomUUID()}, 'locality', ${ancestorIds})
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return locality.id as string;
}

async function createZone(): Promise<string> {
  const [zone] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"Test Zone " + crypto.randomUUID()}, ${"test-zone-" + crypto.randomUUID()}, 'zone')
    RETURNING id`;
  createdAreaIds.push(zone.id);
  return zone.id as string;
}

async function postReferral(areaId: string, therapistId: string): Promise<void> {
  const [ref] = await client`
    INSERT INTO home_case_referrals (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, area_id)
    VALUES (${therapistId}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', true, ${areaId})
    RETURNING id`;
  createdReferralIds.push(ref.id);
}

async function createTherapist(areaId?: string): Promise<string> {
  const email = `digest-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, profile_status)
    VALUES (${authUser.id}, ${email}, 'therapist', 'active')`;
  createdUserIds.push(authUser.id);
  if (areaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${areaId})`;
  }
  return authUser.id;
}

describe("buildWeeklyDigestSummary", () => {
  it("returns all-zero for a therapist with no home-visit area on file", async () => {
    const userId = await createTherapist();
    const summary = await buildWeeklyDigestSummary(db, userId, new Date(0));
    expect(summary).toEqual({ newSignupsNearby: 0, referralsPostedNearby: 0, referralsResolvedNearby: 0 });
  });

  it("counts a referral posted in the therapist's own covered area", async () => {
    const areaId = await createLocality();
    const userId = await createTherapist(areaId);
    const since = new Date(Date.now() - 60_000);
    await postReferral(areaId, userId);

    const summary = await buildWeeklyDigestSummary(db, userId, since);
    expect(summary.referralsPostedNearby).toBe(1);
  });

  it("does NOT count a referral posted in an unrelated area (regression: this used to be a platform-wide count)", async () => {
    const myArea = await createLocality();
    const otherArea = await createLocality();
    const userId = await createTherapist(myArea);
    const otherPoster = await createTherapist(otherArea);
    const since = new Date(Date.now() - 60_000);
    await postReferral(otherArea, otherPoster);

    const summary = await buildWeeklyDigestSummary(db, userId, since);
    expect(summary.referralsPostedNearby).toBe(0);
  });

  it("counts a referral posted in a locality nested under a zone the therapist covers (parent-zone fallback)", async () => {
    const zoneId = await createZone();
    const localityId = await createLocality([zoneId]); // locality's ancestor_ids includes the zone
    const userId = await createTherapist(zoneId); // therapist covers the broader zone, not the specific locality
    const since = new Date(Date.now() - 60_000);
    await postReferral(localityId, userId);

    const summary = await buildWeeklyDigestSummary(db, userId, since);
    expect(summary.referralsPostedNearby).toBe(1);
  });

  it("does NOT count a new signup outside the therapist's covered areas", async () => {
    const myArea = await createLocality();
    const otherArea = await createLocality();
    const userId = await createTherapist(myArea);
    // since is set after the subject therapist's own signup (with a real
    // gap, not just a 1ms offset — createdAt is DB-assigned via
    // defaultNow(), so ordering needs an actual elapsed interval to be
    // reliable), so only signups created below fall inside the window.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const since = new Date();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await createTherapist(otherArea); // a new signup, but in an unrelated area

    const summary = await buildWeeklyDigestSummary(db, userId, since);
    expect(summary.newSignupsNearby).toBe(0);
  });

  it("counts a new signup inside the therapist's covered area", async () => {
    const myArea = await createLocality();
    const userId = await createTherapist(myArea);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const since = new Date();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await createTherapist(myArea); // a second therapist signing up in the same area

    const summary = await buildWeeklyDigestSummary(db, userId, since);
    expect(summary.newSignupsNearby).toBe(1);
  });
});

describe("digestMessage", () => {
  it("renders a human-readable summary with the real numbers", () => {
    const message = digestMessage({ newSignupsNearby: 2, referralsPostedNearby: 1, referralsResolvedNearby: 0 });
    expect(message.body).toContain("2 new signups");
    expect(message.body).toContain("1 referral posted");
  });
});

describe("enqueueWeeklyDigests", () => {
  it("enqueues exactly one email-channel row per active therapist, once per day", async () => {
    const userId = await createTherapist();
    const now = new Date();

    const first = await enqueueWeeklyDigests(db, now);
    expect(first.enqueued).toBeGreaterThanOrEqual(1);

    const rows = await client`SELECT channel, template FROM notification_outbox WHERE user_id = ${userId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("email");
    expect(rows[0].template).toBe("weekly_digest");

    // Re-running the same day is a no-op for this user (dedupe_key collision).
    await enqueueWeeklyDigests(db, now);
    const after = await client`SELECT id FROM notification_outbox WHERE user_id = ${userId}`;
    expect(after).toHaveLength(1);
  });
});
