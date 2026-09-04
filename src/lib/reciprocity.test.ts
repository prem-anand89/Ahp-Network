// §10H — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { getReciprocityStats } from "./reciprocity";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdReferralIds: string[] = [];

afterEach(async () => {
  let referralId: string | undefined;
  while ((referralId = createdReferralIds.pop()) !== undefined) {
    await client`DELETE FROM referral_interest WHERE referral_id = ${referralId}`;
    await client`DELETE FROM home_case_referrals WHERE id = ${referralId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `reciprocity-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function createReferral(posterId: string): Promise<string> {
  const [ref] = await client`
    INSERT INTO home_case_referrals (posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required)
    VALUES (${posterId}, 'therapist', 'physiotherapist', 'musculoskeletal_orthopaedic', true)
    RETURNING id`;
  createdReferralIds.push(ref.id);
  return ref.id;
}

describe("getReciprocityStats (§10H — private, first-person, never comparative)", () => {
  it("counts this month's accepted interests, not other statuses", async () => {
    const poster = await createUser();
    const therapist = await createUser();
    const referral = await createReferral(poster);

    await client`
      INSERT INTO referral_interest (referral_id, therapist_user_id, status, responded_at)
      VALUES (${referral}, ${therapist}, 'accepted', now())`;

    const otherReferral = await createReferral(poster);
    await client`
      INSERT INTO referral_interest (referral_id, therapist_user_id, status)
      VALUES (${otherReferral}, ${therapist}, 'pending')`;

    const stats = await getReciprocityStats(db, therapist);
    expect(stats.connectedThisMonth).toBe(1);
  });

  it("excludes an acceptance from a prior month", async () => {
    const poster = await createUser();
    const therapist = await createUser();
    const referral = await createReferral(poster);
    await client`
      INSERT INTO referral_interest (referral_id, therapist_user_id, status, responded_at)
      VALUES (${referral}, ${therapist}, 'accepted', '2020-01-15T00:00:00Z')`;

    const stats = await getReciprocityStats(db, therapist, new Date("2026-06-01"));
    expect(stats.connectedThisMonth).toBe(0);
  });
});
