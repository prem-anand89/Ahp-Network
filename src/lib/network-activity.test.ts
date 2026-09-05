// §9/§10H — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { getNetworkActivityFeed } from "./network-activity";

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

async function createLocality(): Promise<string> {
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level) VALUES (${"Test Locality " + crypto.randomUUID()}, ${"test-locality-" + crypto.randomUUID()}, 'locality')
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return locality.id as string;
}

async function createTherapist(opts: {
  role: string;
  specializations: string[];
  verificationStage?: string;
  areaId?: string;
}): Promise<string> {
  const email = `feed-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, role, specializations, verification_stage)
    VALUES (${authUser.id}, ${email}, 'therapist', ${opts.role}, ${opts.specializations}, ${opts.verificationStage ?? "credentials_verified"})`;
  createdUserIds.push(authUser.id);
  if (opts.areaId) {
    await client`INSERT INTO home_visit_areas (user_id, area_id) VALUES (${authUser.id}, ${opts.areaId})`;
  }
  return authUser.id;
}

async function createOpenReferral(posterId: string, areaId: string): Promise<string> {
  const [ref] = await client`
    INSERT INTO home_case_referrals (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, area_id)
    VALUES (${posterId}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', true, ${areaId})
    RETURNING id`;
  createdReferralIds.push(ref.id);
  return ref.id;
}

describe("getNetworkActivityFeed (§9)", () => {
  it("shows every open referral platform-wide, marking whether the viewer matches", async () => {
    const areaId = await createLocality();
    const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
    const referralId = await createOpenReferral(poster, areaId);

    const matchingViewer = await createTherapist({
      role: "physiotherapist",
      specializations: ["musculoskeletal_orthopaedic"],
      areaId,
    });
    const nonMatchingViewer = await createTherapist({
      role: "occupational_therapist",
      specializations: [],
    });

    const feedForMatch = await getNetworkActivityFeed(db, matchingViewer);
    const feedForNonMatch = await getNetworkActivityFeed(db, nonMatchingViewer);

    const inMatch = feedForMatch.find((i) => i.kind === "referral" && i.id === referralId);
    const inNonMatch = feedForNonMatch.find((i) => i.kind === "referral" && i.id === referralId);

    expect(inMatch && "matchesViewer" in inMatch ? inMatch.matchesViewer : undefined).toBe(true);
    expect(inNonMatch && "matchesViewer" in inNonMatch ? inNonMatch.matchesViewer : undefined).toBe(false);
  });

  it("never exposes patient_summary — only structured fields are selected at all", async () => {
    const areaId = await createLocality();
    const poster = await createTherapist({ role: "physiotherapist", specializations: [] });
    await createOpenReferral(poster, areaId);
    const viewer = await createTherapist({ role: "physiotherapist", specializations: [] });

    const feed = await getNetworkActivityFeed(db, viewer);
    for (const item of feed) {
      expect(Object.keys(item)).not.toContain("patientSummary");
    }
  });
});
