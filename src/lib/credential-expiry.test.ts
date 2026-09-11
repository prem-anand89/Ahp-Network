// §8A1a — runs against a real local Postgres, never mocks. Proves the job
// this file exists for: a credential expiring after approval must actually
// cause verification_stage to react, not just sit correct-but-unreached
// inside recompute_verification_stage() forever.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { recomputeExpiredVerificationStages } from "./credential-expiry";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
  let id: string | undefined;
  while ((id = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM credentials WHERE user_id = ${id}`;
    await client`DELETE FROM course_completions WHERE user_id = ${id}`;
    await client`DELETE FROM users WHERE id = ${id}`;
    await client`DELETE FROM auth.users WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createTherapist(email: string): Promise<string> {
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function getOrCreateCouncil(name: string, councilType: string): Promise<string> {
  const [existing] = await client`SELECT id FROM master_councils WHERE name = ${name}`;
  if (existing) return existing.id;
  const [row] = await client`
    INSERT INTO master_councils (name, council_type) VALUES (${name}, ${councilType}) RETURNING id`;
  return row.id;
}

describe("recomputeExpiredVerificationStages — §8A1a credential-expiry job", () => {
  it("downgrades a user whose only qualifying credential expired", async () => {
    const userId = await createTherapist(`expiry-downgrade-${crypto.randomUUID()}@test.local`);
    await client`
      INSERT INTO credentials (user_id, type, status, expiry_date)
      VALUES (${userId}, 'degree', 'approved', now() - interval '1 day')`;
    // Seed the stage as if it was approved before expiry, same as a real
    // admin approval would have set it — this job's whole point is
    // reacting to state going stale after that.
    await client`SELECT recompute_verification_stage(${userId})`;
    await client`UPDATE users SET verification_stage = 'qualification_confirmed' WHERE id = ${userId}`;

    const result = await recomputeExpiredVerificationStages(db);
    expect(result.usersRecomputed).toBeGreaterThanOrEqual(1);

    const [user] = await client`SELECT verification_stage FROM users WHERE id = ${userId}`;
    expect(user.verification_stage).toBe("unverified");
  });

  it("leaves a user with only still-valid credentials untouched", async () => {
    const userId = await createTherapist(`expiry-untouched-${crypto.randomUUID()}@test.local`);
    await client`
      INSERT INTO credentials (user_id, type, status)
      VALUES (${userId}, 'degree', 'approved')`;
    await client`SELECT recompute_verification_stage(${userId})`;

    await recomputeExpiredVerificationStages(db);

    const [user] = await client`SELECT verification_stage FROM users WHERE id = ${userId}`;
    expect(user.verification_stage).toBe("qualification_confirmed");
  });

  it("drops credentials_verified to qualification_confirmed when only the statutory registration expired", async () => {
    const userId = await createTherapist(`expiry-partial-${crypto.randomUUID()}@test.local`);
    const ncahpId = await getOrCreateCouncil(`NCAHP-${crypto.randomUUID()}`, "statutory_registration");
    await client`INSERT INTO credentials (user_id, type, status) VALUES (${userId}, 'degree', 'approved')`;
    await client`
      INSERT INTO credentials (user_id, type, status, council_id, expiry_date)
      VALUES (${userId}, 'council_registration', 'approved', ${ncahpId}, now() - interval '1 day')`;
    await client`UPDATE users SET verification_stage = 'credentials_verified' WHERE id = ${userId}`;

    await recomputeExpiredVerificationStages(db);

    const [user] = await client`SELECT verification_stage FROM users WHERE id = ${userId}`;
    expect(user.verification_stage).toBe("qualification_confirmed");
  });

  it("is idempotent — running it twice recomputes the same stage, not a further downgrade", async () => {
    const userId = await createTherapist(`expiry-idempotent-${crypto.randomUUID()}@test.local`);
    await client`
      INSERT INTO credentials (user_id, type, status, expiry_date)
      VALUES (${userId}, 'degree', 'approved', now() - interval '1 day')`;
    await client`UPDATE users SET verification_stage = 'qualification_confirmed' WHERE id = ${userId}`;

    await recomputeExpiredVerificationStages(db);
    await recomputeExpiredVerificationStages(db);

    const [user] = await client`SELECT verification_stage FROM users WHERE id = ${userId}`;
    expect(user.verification_stage).toBe("unverified");
  });
});
