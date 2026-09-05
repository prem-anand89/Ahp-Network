// §8H — runs against a real local Postgres, never mocks the database.
// R2 network calls are the one exception: spied on the shared AwsClient
// prototype (same technique as r2.test.ts) so this suite never needs real
// R2 credentials or a live bucket.

import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AwsClient } from "aws4fetch";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { runRetentionPurge } from "./retention";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const testR2Env = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
};

const createdUserIds: string[] = [];
const createdPracticeIds: string[] = [];

beforeEach(() => {
  vi.spyOn(AwsClient.prototype, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(async () => {
  vi.restoreAllMocks();

  let practiceId: string | undefined;
  while ((practiceId = createdPracticeIds.pop()) !== undefined) {
    await client`DELETE FROM practice_claims WHERE practice_id = ${practiceId}`;
    await client`DELETE FROM practices WHERE id = ${practiceId}`;
  }

  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM audit_logs WHERE actor_user_id = ${userId}`;
    await client`DELETE FROM feedback WHERE user_id = ${userId}`;
    await client`DELETE FROM notification_outbox WHERE user_id = ${userId}`;
    await client`DELETE FROM push_subscriptions WHERE user_id = ${userId}`;
    await client`DELETE FROM profile_contact_reveals WHERE profile_user_id = ${userId}`;
    await client`DELETE FROM home_case_referrals WHERE posted_by_user_id = ${userId}`;
    await client`DELETE FROM practice_claims WHERE claimant_user_id = ${userId}`;
    await client`DELETE FROM credentials WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `retention-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("runRetentionPurge — credential documents (§8H: 12mo post-verification)", () => {
  it("deletes the R2 object and nulls document fields for an old approved credential", async () => {
    const userId = await createUser();
    const oldVerifiedAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const [row] = await client`
      INSERT INTO credentials (user_id, type, status, document_url, registration_number, ocr_extracted_json, verified_at)
      VALUES (${userId}, 'degree', 'approved', 'credentials/some-key.pdf', 'REG123', '{"a":1}'::jsonb, ${oldVerifiedAt.toISOString()})
      RETURNING id`;

    const result = await runRetentionPurge(db, testR2Env);
    expect(result.credentialsDocumentsPurged).toBe(1);

    const [after] = await client`SELECT document_url, registration_number, ocr_extracted_json, status, verified_at FROM credentials WHERE id = ${row.id}`;
    expect(after.document_url).toBeNull();
    expect(after.registration_number).toBeNull();
    expect(after.ocr_extracted_json).toBeNull();
    expect(after.status).toBe("approved");
    expect(after.verified_at).not.toBeNull();
  });

  it("leaves a recently verified credential's document untouched", async () => {
    const userId = await createUser();
    const [row] = await client`
      INSERT INTO credentials (user_id, type, status, document_url, verified_at)
      VALUES (${userId}, 'degree', 'approved', 'credentials/recent-key.pdf', now())
      RETURNING id`;

    await runRetentionPurge(db, testR2Env);

    const [after] = await client`SELECT document_url FROM credentials WHERE id = ${row.id}`;
    expect(after.document_url).toBe("credentials/recent-key.pdf");
  });
});

describe("runRetentionPurge — referral contact fields (§8H: 90 days post-completed/expired)", () => {
  it("nulls patient_summary and location_address on an old completed referral", async () => {
    const userId = await createUser();
    const oldUpdatedAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const [row] = await client`
      INSERT INTO home_case_referrals
        (status, posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, patient_summary, location_address, updated_at)
      VALUES ('completed', ${userId}, 'therapist', 'physiotherapist', 'neuro_rehab', true, 'a patient summary here', 'somewhere', ${oldUpdatedAt.toISOString()})
      RETURNING id`;

    const result = await runRetentionPurge(db, testR2Env);
    expect(result.referralContactFieldsPurged).toBeGreaterThanOrEqual(1);

    const [after] = await client`SELECT patient_summary, location_address, status FROM home_case_referrals WHERE id = ${row.id}`;
    expect(after.patient_summary).toBeNull();
    expect(after.location_address).toBeNull();
    expect(after.status).toBe("completed");
  });

  it("leaves an open referral's contact fields untouched regardless of age", async () => {
    const userId = await createUser();
    const oldUpdatedAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const [row] = await client`
      INSERT INTO home_case_referrals
        (status, posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, patient_summary, updated_at)
      VALUES ('open', ${userId}, 'therapist', 'physiotherapist', 'neuro_rehab', true, 'still open, keep me', ${oldUpdatedAt.toISOString()})
      RETURNING id`;

    await runRetentionPurge(db, testR2Env);

    const [after] = await client`SELECT patient_summary FROM home_case_referrals WHERE id = ${row.id}`;
    expect(after.patient_summary).toBe("still open, keep me");
  });
});

describe("runRetentionPurge — push subscriptions (§8H: no delivery in 90 days)", () => {
  it("deletes a subscription with no recent successful delivery", async () => {
    const userId = await createUser();
    const oldLastSeen = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await client`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, last_seen_at)
      VALUES (${userId}, ${"https://push.example/" + crypto.randomUUID()}, 'p', 'a', ${oldLastSeen.toISOString()})`;

    const result = await runRetentionPurge(db, testR2Env);
    expect(result.pushSubscriptionsPurged).toBeGreaterThanOrEqual(1);

    const [row] = await client`SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = ${userId}`;
    expect(row.n).toBe(0);
  });

  it("keeps a subscription seen recently", async () => {
    const userId = await createUser();
    await client`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, last_seen_at)
      VALUES (${userId}, ${"https://push.example/" + crypto.randomUUID()}, 'p', 'a', now())`;

    await runRetentionPurge(db, testR2Env);

    const [row] = await client`SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = ${userId}`;
    expect(row.n).toBe(1);
  });
});

describe("runRetentionPurge — practice claim documents (§8H: 12mo post-decision)", () => {
  it("deletes the R2 object and clears document fields for an old decided claim", async () => {
    const claimant = await createUser();
    const [practice] = await client`INSERT INTO practices (name, type, created_by_user_id) VALUES ('Test Clinic', 'clinic', ${claimant}) RETURNING id`;
    createdPracticeIds.push(practice.id);
    const oldReviewedAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const [claim] = await client`
      INSERT INTO practice_claims (practice_id, claimant_user_id, claimed_relationship, document_url, registration_number, status, reviewed_at)
      VALUES (${practice.id}, ${claimant}, 'owner', 'credentials/claim-doc.pdf', 'REG987', 'approved', ${oldReviewedAt.toISOString()})
      RETURNING id`;

    const result = await runRetentionPurge(db, testR2Env);
    expect(result.practiceClaimsDocumentsPurged).toBe(1);

    const [after] = await client`SELECT document_url, registration_number, status FROM practice_claims WHERE id = ${claim.id}`;
    expect(after.document_url).toBe("");
    expect(after.registration_number).toBeNull();
    expect(after.status).toBe("approved");
  });
});

describe("runRetentionPurge — contact reveal metadata (§8H: 90 days)", () => {
  it("nulls user_agent on an old reveal, keeps ip_hash and timestamps", async () => {
    const profileUser = await createUser();
    const oldRevealedAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const [row] = await client`
      INSERT INTO profile_contact_reveals (profile_user_id, ip_hash, user_agent, revealed_at)
      VALUES (${profileUser}, 'somehash', 'Mozilla/5.0', ${oldRevealedAt.toISOString()})
      RETURNING id`;

    const result = await runRetentionPurge(db, testR2Env);
    expect(result.contactRevealsPurged).toBeGreaterThanOrEqual(1);

    const [after] = await client`SELECT ip_hash, user_agent FROM profile_contact_reveals WHERE id = ${row.id}`;
    expect(after.ip_hash).toBe("somehash");
    expect(after.user_agent).toBeNull();
  });
});

describe("runRetentionPurge — feedback messages (§8H: 24 months)", () => {
  it("replaces an old feedback message, keeps category and status", async () => {
    const userId = await createUser();
    const oldCreatedAt = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000);
    const [row] = await client`
      INSERT INTO feedback (user_id, category, message, created_at)
      VALUES (${userId}, 'bug', 'a detailed old bug report', ${oldCreatedAt.toISOString()})
      RETURNING id`;

    const result = await runRetentionPurge(db, testR2Env);
    expect(result.feedbackMessagesPurged).toBeGreaterThanOrEqual(1);

    const [after] = await client`SELECT message, category FROM feedback WHERE id = ${row.id}`;
    expect(after.message).toBe("[purged]");
    expect(after.category).toBe("bug");
  });

  it("leaves a recent feedback message untouched", async () => {
    const userId = await createUser();
    const [row] = await client`
      INSERT INTO feedback (user_id, category, message)
      VALUES (${userId}, 'bug', 'a recent bug report')
      RETURNING id`;

    await runRetentionPurge(db, testR2Env);

    const [after] = await client`SELECT message FROM feedback WHERE id = ${row.id}`;
    expect(after.message).toBe("a recent bug report");
  });
});

describe("runRetentionPurge — notification_outbox payloads (§8H: 90 days)", () => {
  it("empties an old notification's payload", async () => {
    const userId = await createUser();
    const oldCreatedAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const [row] = await client`
      INSERT INTO notification_outbox (user_id, channel, template, payload, created_at)
      VALUES (${userId}, 'push', 'shortlist', '{"referralId":"abc"}'::jsonb, ${oldCreatedAt.toISOString()})
      RETURNING id`;

    const result = await runRetentionPurge(db, testR2Env);
    expect(result.notificationPayloadsPurged).toBeGreaterThanOrEqual(1);

    const [after] = await client`SELECT payload FROM notification_outbox WHERE id = ${row.id}`;
    expect(after.payload).toEqual({});
  });
});

describe("runRetentionPurge — audit_logs (§8H: 24 months, via purge_old_audit_logs())", () => {
  it("deletes rows older than 24 months and keeps recent ones", async () => {
    const userId = await createUser();
    const oldCreatedAt = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000);
    await client`
      INSERT INTO audit_logs (actor_user_id, actor_type, action, outcome, created_at)
      VALUES (${userId}, 'admin', 'old_test_action', 'success', ${oldCreatedAt.toISOString()})`;
    await client`
      INSERT INTO audit_logs (actor_user_id, actor_type, action, outcome)
      VALUES (${userId}, 'admin', 'recent_test_action', 'success')`;

    const result = await runRetentionPurge(db, testR2Env);
    expect(result.auditLogsPurged).toBeGreaterThanOrEqual(1);

    const rows = await client`SELECT action FROM audit_logs WHERE actor_user_id = ${userId}`;
    expect(rows.map((r) => r.action)).toEqual(["recent_test_action"]);
  });
});
