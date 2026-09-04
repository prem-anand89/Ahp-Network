// §10B/§10C/§10D — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  completeProfileStep2Tx,
  getLocalityContext,
  getRecentNewMembers,
  recordOnboardingMoment,
} from "./onboarding";

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
    await client`DELETE FROM user_onboarding_moments WHERE user_id = ${userId}`;
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

async function createLocality() {
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"Test Locality " + crypto.randomUUID()}, ${"test-locality-" + crypto.randomUUID()}, 'locality')
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return locality.id as string;
}

async function createUser(overrides: { verificationStage?: string } = {}): Promise<string> {
  const email = `onboard-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, verification_stage)
    VALUES (${authUser.id}, ${email}, 'therapist', ${overrides.verificationStage ?? "unverified"})`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("recordOnboardingMoment (§10B)", () => {
  it("records a moment once and is idempotent on repeat calls", async () => {
    const userId = await createUser();

    await recordOnboardingMoment(db, userId, "profile_preview_shown");
    await recordOnboardingMoment(db, userId, "profile_preview_shown");

    const rows = await client`SELECT * FROM user_onboarding_moments WHERE user_id = ${userId}`;
    expect(rows).toHaveLength(1);
  });
});

describe("completeProfileStep2Tx (§10C step 2)", () => {
  it("sets display name, role, and a home-visit area", async () => {
    const userId = await createUser();
    const areaId = await createLocality();

    await completeProfileStep2Tx(db, userId, { displayName: "Priya Nair", role: "physiotherapist", areaId });

    const [user] = await client`SELECT display_name, role FROM users WHERE id = ${userId}`;
    expect(user.display_name).toBe("Priya Nair");
    expect(user.role).toBe("physiotherapist");

    const areas = await client`SELECT area_id FROM home_visit_areas WHERE user_id = ${userId}`;
    expect(areas.map((a) => a.area_id)).toContain(areaId);
  });
});

describe("getLocalityContext (§10D — never a bare zero)", () => {
  it("reports founding-cohort framing when a locality has no active therapist or open referral", async () => {
    const areaId = await createLocality();

    const context = await getLocalityContext(db, areaId);

    expect(context.count).toBe(0);
    expect(context.isFoundingCohortFraming).toBe(true);
  });

  it("reports a real count once an active therapist covers the locality", async () => {
    const areaId = await createLocality();
    const userId = await createUser();
    await client`UPDATE users SET profile_status = 'active' WHERE id = ${userId}`;
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${userId}, ${areaId})`;

    const context = await getLocalityContext(db, areaId);

    expect(context.count).toBe(1);
    expect(context.isFoundingCohortFraming).toBe(false);
  });
});

describe("getRecentNewMembers (§9/§10H new-member cards)", () => {
  it("surfaces a recently verified signup, never an unverified one", async () => {
    const verified = await createUser({ verificationStage: "credentials_verified" });
    await client`UPDATE users SET profile_status = 'active' WHERE id = ${verified}`;
    const unverified = await createUser({ verificationStage: "unverified" });
    await client`UPDATE users SET profile_status = 'active' WHERE id = ${unverified}`;

    const members = await getRecentNewMembers(db);

    const ids = members.map((m) => m.userId);
    expect(ids).toContain(verified);
    expect(ids).not.toContain(unverified);
  });
});
