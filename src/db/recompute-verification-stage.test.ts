// Runs against a real Postgres (local dev instance), never mocks — per
// BUILD_SEQUENCE.md Phase 0's test-stack convention.
//
// This is the single most consequential test in Phase 3
// (BUILD_SEQUENCE.md's own words): a council_registration credential
// linked to a professional_association council (IAP) must never by
// itself advance verification_stage to credentials_verified, no matter
// how it's approved. Tested against recompute_verification_stage()
// itself, not any caller, since that function is the ONLY writer of
// users.verification_stage (§8A1a / CLAUDE.md non-negotiable).

import { afterAll, afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";

const db = postgres(adminUrl, { prepare: false, max: 2 });

const createdUserIds: string[] = [];

afterEach(async () => {
  let id: string | undefined;
  while ((id = createdUserIds.pop()) !== undefined) {
    await db`DELETE FROM credentials WHERE user_id = ${id}`;
    await db`DELETE FROM course_completions WHERE user_id = ${id}`;
    await db`DELETE FROM users WHERE id = ${id}`;
    await db`DELETE FROM auth.users WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await db.end();
});

async function createTherapist(email: string): Promise<string> {
  const [authUser] = await db`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await db`
    INSERT INTO users (id, email, account_type)
    VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function approvedDegree(userId: string) {
  await db`
    INSERT INTO credentials (user_id, type, status)
    VALUES (${userId}, 'degree', 'approved')`;
}

async function approvedCouncilRegistration(userId: string, councilId: string) {
  await db`
    INSERT INTO credentials (user_id, type, status, council_id)
    VALUES (${userId}, 'council_registration', 'approved', ${councilId})`;
}

async function getOrCreateCouncil(name: string, councilType: string): Promise<string> {
  const [existing] = await db`SELECT id FROM master_councils WHERE name = ${name}`;
  if (existing) return existing.id;
  const [row] = await db`
    INSERT INTO master_councils (name, council_type) VALUES (${name}, ${councilType}) RETURNING id`;
  return row.id;
}

describe("recompute_verification_stage() — §8A1a two-tier verification", () => {
  it("stays unverified with no approved credentials", async () => {
    const userId = await createTherapist("stage-unverified@example.com");
    const [{ recompute_verification_stage: stage }] =
      await db`SELECT recompute_verification_stage(${userId})`;
    expect(stage).toBe("unverified");
  });

  it("advances to qualification_confirmed on an approved degree alone", async () => {
    const userId = await createTherapist("stage-qc@example.com");
    await approvedDegree(userId);
    const [{ recompute_verification_stage: stage }] =
      await db`SELECT recompute_verification_stage(${userId})`;
    expect(stage).toBe("qualification_confirmed");

    const [user] = await db`SELECT verification_stage FROM users WHERE id = ${userId}`;
    expect(user.verification_stage).toBe("qualification_confirmed");
  });

  it("HARD RULE: an IAP (professional_association) registration never advances to credentials_verified, even with a degree", async () => {
    const userId = await createTherapist("stage-iap-only@example.com");
    const iapId = await getOrCreateCouncil("IAP", "professional_association");
    await approvedDegree(userId);
    await approvedCouncilRegistration(userId, iapId);

    const [{ recompute_verification_stage: stage }] =
      await db`SELECT recompute_verification_stage(${userId})`;
    expect(stage).toBe("qualification_confirmed");
    expect(stage).not.toBe("credentials_verified");
  });

  it("advances to credentials_verified with a degree plus a statutory_registration council", async () => {
    const userId = await createTherapist("stage-cv@example.com");
    const ncahpId = await getOrCreateCouncil("NCAHP", "statutory_registration");
    await approvedDegree(userId);
    await approvedCouncilRegistration(userId, ncahpId);

    const [{ recompute_verification_stage: stage }] =
      await db`SELECT recompute_verification_stage(${userId})`;
    expect(stage).toBe("credentials_verified");
  });

  it("does not count an expired council registration", async () => {
    const userId = await createTherapist("stage-expired@example.com");
    const ncahpId = await getOrCreateCouncil("NCAHP", "statutory_registration");
    await approvedDegree(userId);
    await db`
      INSERT INTO credentials (user_id, type, status, council_id, expiry_date)
      VALUES (${userId}, 'council_registration', 'approved', ${ncahpId}, now() - interval '1 day')`;

    const [{ recompute_verification_stage: stage }] =
      await db`SELECT recompute_verification_stage(${userId})`;
    expect(stage).toBe("qualification_confirmed");
  });
});

describe("sync_degree_to_course_completion() — §8A1a one-way sync", () => {
  it("creates a Tier 1 course_completions row from an approved degree, without duplicating on a second call", async () => {
    const userId = await createTherapist("sync-degree@example.com");
    const [credential] = await db`
      INSERT INTO credentials (user_id, type, status) VALUES (${userId}, 'degree', 'approved') RETURNING id`;

    await db`SELECT sync_degree_to_course_completion(${credential.id})`;
    await db`SELECT sync_degree_to_course_completion(${credential.id})`;

    const rows = await db`
      SELECT custom_course_name, curation_status FROM course_completions
      WHERE user_id = ${userId} AND deleted_at IS NULL`;
    expect(rows).toHaveLength(1);
    expect(rows[0].custom_course_name).toBe("Graduation");
    expect(rows[0].curation_status).toBe("approved");

    await db`DELETE FROM course_completions WHERE user_id = ${userId}`;
    await db`DELETE FROM credentials WHERE user_id = ${userId}`;
  });

  it("does nothing for a council_registration credential", async () => {
    const userId = await createTherapist("sync-council@example.com");
    const ncahpId = await getOrCreateCouncil("NCAHP", "statutory_registration");
    const [credential] = await db`
      INSERT INTO credentials (user_id, type, status, council_id)
      VALUES (${userId}, 'council_registration', 'approved', ${ncahpId}) RETURNING id`;

    await db`SELECT sync_degree_to_course_completion(${credential.id})`;

    const rows = await db`SELECT 1 FROM course_completions WHERE user_id = ${userId}`;
    expect(rows).toHaveLength(0);

    await db`DELETE FROM credentials WHERE user_id = ${userId}`;
  });
});
