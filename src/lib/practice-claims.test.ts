// Runs against a real Postgres (local dev instance), never mocks — per
// BUILD_SEQUENCE.md Phase 0's test-stack convention.
//
// BUILD_SEQUENCE.md Phase 4's own "Done when": "a second contested claim
// on the same practice correctly freezes the record instead of erroring
// out." Tested directly against submitPracticeClaimTx, not the server
// action wrapper, since the wrapper only resolves auth.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { submitPracticeClaimTx } from "./practice-claims";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";

const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdPracticeIds: string[] = [];

afterEach(async () => {
  let practiceId: string | undefined;
  while ((practiceId = createdPracticeIds.pop()) !== undefined) {
    await client`DELETE FROM practice_claims WHERE practice_id = ${practiceId}`;
    await client`DELETE FROM practice_users WHERE practice_id = ${practiceId}`;
    await client`DELETE FROM practices WHERE id = ${practiceId}`;
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

async function createTherapist(email: string): Promise<string> {
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type)
    VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function createUnclaimedPractice(createdByUserId: string): Promise<string> {
  const [practice] = await client`
    INSERT INTO practices (name, type, created_by_user_id, normalized_name, normalized_address)
    VALUES ('Test Physio Clinic', 'clinic', ${createdByUserId}, 'test physio clinic', 'test address')
    RETURNING id`;
  createdPracticeIds.push(practice.id);
  return practice.id;
}

describe("submitPracticeClaimTx — §8C1 contested claims", () => {
  it("the first claim on an unclaimed practice moves it to claim_pending", async () => {
    const creator = await createTherapist("claim-creator-1@example.com");
    const claimant = await createTherapist("claim-claimant-1@example.com");
    const practiceId = await createUnclaimedPractice(creator);

    const result = await submitPracticeClaimTx(db, {
      practiceId,
      claimantUserId: claimant,
      claimedRelationship: "owner",
      documentUrl: "practice-claims/x/doc.pdf",
    });

    expect(result.disputed).toBe(false);

    const [practice] = await client`SELECT claim_status FROM practices WHERE id = ${practiceId}`;
    expect(practice.claim_status).toBe("claim_pending");
  });

  it("a second, DIFFERENT claimant's claim freezes the record as disputed instead of erroring", async () => {
    const creator = await createTherapist("claim-creator-2@example.com");
    const firstClaimant = await createTherapist("claim-first-2@example.com");
    const secondClaimant = await createTherapist("claim-second-2@example.com");
    const practiceId = await createUnclaimedPractice(creator);

    await submitPracticeClaimTx(db, {
      practiceId,
      claimantUserId: firstClaimant,
      claimedRelationship: "owner",
      documentUrl: "practice-claims/x/first.pdf",
    });

    const secondResult = await submitPracticeClaimTx(db, {
      practiceId,
      claimantUserId: secondClaimant,
      claimedRelationship: "owner",
      documentUrl: "practice-claims/x/second.pdf",
    });

    expect(secondResult.disputed).toBe(true);

    const [practice] = await client`SELECT claim_status FROM practices WHERE id = ${practiceId}`;
    expect(practice.claim_status).toBe("disputed");

    const claims = await client`
      SELECT claimant_user_id, status FROM practice_claims WHERE practice_id = ${practiceId}`;
    expect(claims).toHaveLength(2);
    expect(claims.every((c) => c.status === "submitted")).toBe(true);
  });

  it("rejects a second claim from the SAME claimant on an already-pending practice", async () => {
    const creator = await createTherapist("claim-creator-3@example.com");
    const claimant = await createTherapist("claim-claimant-3@example.com");
    const practiceId = await createUnclaimedPractice(creator);

    await submitPracticeClaimTx(db, {
      practiceId,
      claimantUserId: claimant,
      claimedRelationship: "owner",
      documentUrl: "practice-claims/x/first.pdf",
    });

    await expect(
      submitPracticeClaimTx(db, {
        practiceId,
        claimantUserId: claimant,
        claimedRelationship: "owner",
        documentUrl: "practice-claims/x/again.pdf",
      }),
    ).rejects.toThrow(/already have an open claim/);
  });

  it("rejects any new claim on an already-claimed practice", async () => {
    const creator = await createTherapist("claim-creator-4@example.com");
    const claimant = await createTherapist("claim-claimant-4@example.com");
    const practiceId = await createUnclaimedPractice(creator);
    await client`UPDATE practices SET claim_status = 'claimed' WHERE id = ${practiceId}`;

    await expect(
      submitPracticeClaimTx(db, {
        practiceId,
        claimantUserId: claimant,
        claimedRelationship: "owner",
        documentUrl: "practice-claims/x/late.pdf",
      }),
    ).rejects.toThrow(/already been claimed/);
  });

  it("rejects any new claim on a practice already frozen as disputed", async () => {
    const creator = await createTherapist("claim-creator-5@example.com");
    const claimant = await createTherapist("claim-claimant-5@example.com");
    const practiceId = await createUnclaimedPractice(creator);
    await client`UPDATE practices SET claim_status = 'disputed' WHERE id = ${practiceId}`;

    await expect(
      submitPracticeClaimTx(db, {
        practiceId,
        claimantUserId: claimant,
        claimedRelationship: "owner",
        documentUrl: "practice-claims/x/third.pdf",
      }),
    ).rejects.toThrow(/under dispute/);
  });
});
