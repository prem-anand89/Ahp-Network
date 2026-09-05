// §8H "on erasure request" — runs against a real local Postgres, never
// mocks the database. R2 calls are spied the same way as retention.test.ts.

import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AwsClient } from "aws4fetch";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { runErasureRequestTx } from "./erasure";

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

beforeEach(() => {
  vi.spyOn(AwsClient.prototype, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(async () => {
  vi.restoreAllMocks();

  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM audit_logs WHERE actor_user_id = ${userId}`;
    await client`DELETE FROM feedback WHERE user_id = ${userId}`;
    await client`DELETE FROM invites WHERE inviter_user_id = ${userId}`;
    await client`DELETE FROM push_subscriptions WHERE user_id = ${userId}`;
    await client`DELETE FROM profile_contact_reveals WHERE profile_user_id = ${userId}`;
    await client`DELETE FROM home_case_referrals WHERE posted_by_user_id = ${userId}`;
    await client`DELETE FROM credentials WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `erasure-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, legal_name, display_name, photo_url, bio, availability_notes, slug)
    VALUES (${authUser.id}, ${email}, 'therapist', 'Real Legal Name', 'Display Name', 'https://photo.example/x.jpg', 'a bio', 'available weekdays', 'display-name')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("runErasureRequestTx (§8H)", () => {
  it("anonymises the users row irreversibly", async () => {
    const target = await createUser();
    const admin = await createUser();

    await runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target });

    const [row] = await client`SELECT email, display_name, legal_name, photo_url, bio, availability_notes, slug, profile_visibility, profile_status, deleted_at FROM users WHERE id = ${target}`;
    expect(row.email).toMatch(/^deleted-user-.+@deleted\.ahpnetwork\.invalid$/);
    expect(row.display_name).toMatch(/^deleted-user-/);
    expect(row.legal_name).toBeNull();
    expect(row.photo_url).toBeNull();
    expect(row.bio).toBeNull();
    expect(row.availability_notes).toBeNull();
    expect(row.slug).toBeNull();
    expect(row.profile_visibility).toBe("hidden");
    expect(row.profile_status).toBe("suspended");
    expect(row.deleted_at).not.toBeNull();
  });

  it("nulls credential document fields but keeps status and verified_at", async () => {
    const target = await createUser();
    const admin = await createUser();
    const [cred] = await client`
      INSERT INTO credentials (user_id, type, status, document_url, registration_number, ocr_extracted_json, verified_at)
      VALUES (${target}, 'degree', 'approved', 'credentials/some-key.pdf', 'REG1', '{"a":1}'::jsonb, now())
      RETURNING id`;

    const result = await runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target });
    expect(result.credentialsAnonymised).toBe(1);

    const [after] = await client`SELECT document_url, registration_number, ocr_extracted_json, status, verified_at FROM credentials WHERE id = ${cred.id}`;
    expect(after.document_url).toBeNull();
    expect(after.registration_number).toBeNull();
    expect(after.ocr_extracted_json).toBeNull();
    expect(after.status).toBe("approved");
    expect(after.verified_at).not.toBeNull();
  });

  it("nulls referral patient_summary/location_address for referrals the user posted", async () => {
    const target = await createUser();
    const admin = await createUser();
    const [referral] = await client`
      INSERT INTO home_case_referrals (status, posted_by_user_id, posted_by_type, role_needed, specialization_needed, home_visit_required, patient_summary, location_address)
      VALUES ('open', ${target}, 'therapist', 'physiotherapist', 'neuro_rehab', true, 'sensitive summary', 'an address')
      RETURNING id`;

    const result = await runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target });
    expect(result.referralsAnonymised).toBe(1);

    const [after] = await client`SELECT patient_summary, location_address FROM home_case_referrals WHERE id = ${referral.id}`;
    expect(after.patient_summary).toBeNull();
    expect(after.location_address).toBeNull();
  });

  it("deletes all push subscriptions for the user", async () => {
    const target = await createUser();
    const admin = await createUser();
    await client`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (${target}, ${"https://push.example/" + crypto.randomUUID()}, 'p', 'a')`;

    const result = await runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target });
    expect(result.pushSubscriptionsDeleted).toBe(1);

    const [row] = await client`SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = ${target}`;
    expect(row.n).toBe(0);
  });

  it("nulls user_agent on contact reveals about the user's own profile", async () => {
    const target = await createUser();
    const admin = await createUser();
    const [reveal] = await client`
      INSERT INTO profile_contact_reveals (profile_user_id, ip_hash, user_agent) VALUES (${target}, 'somehash', 'Mozilla/5.0') RETURNING id`;

    const result = await runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target });
    expect(result.contactRevealsAnonymised).toBe(1);

    const [after] = await client`SELECT ip_hash, user_agent FROM profile_contact_reveals WHERE id = ${reveal.id}`;
    expect(after.ip_hash).toBe("somehash");
    expect(after.user_agent).toBeNull();
  });

  it("anonymises the user's feedback, nulling user_id and the message", async () => {
    const target = await createUser();
    const admin = await createUser();
    const [item] = await client`INSERT INTO feedback (user_id, category, message) VALUES (${target}, 'bug', 'a real bug report') RETURNING id`;

    const result = await runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target });
    expect(result.feedbackAnonymised).toBe(1);

    const [after] = await client`SELECT user_id, message FROM feedback WHERE id = ${item.id}`;
    expect(after.user_id).toBeNull();
    expect(after.message).toBe("[erased]");
  });

  it("redacts the user's invite codes", async () => {
    const target = await createUser();
    const admin = await createUser();
    const [invite] = await client`INSERT INTO invites (inviter_user_id, code, channel) VALUES (${target}, 'ABC12345', 'whatsapp') RETURNING id`;

    const result = await runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target });
    expect(result.invitesAnonymised).toBe(1);

    const [after] = await client`SELECT code FROM invites WHERE id = ${invite.id}`;
    expect(after.code).toBe(`redacted-${invite.id}`);
  });

  it("writes an audit log entry", async () => {
    const target = await createUser();
    const admin = await createUser();

    await runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target });

    const [log] = await client`SELECT action, target_id FROM audit_logs WHERE actor_user_id = ${admin} AND action = 'erasure_request_applied'`;
    expect(log.action).toBe("erasure_request_applied");
    expect(log.target_id).toBe(target);
  });

  it("can be re-run against an already-erased user without error", async () => {
    const target = await createUser();
    const admin = await createUser();

    await runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target });
    await expect(
      runErasureRequestTx(db, testR2Env, { actingUserId: admin, targetUserId: target }),
    ).resolves.not.toThrow();

    const [row] = await client`SELECT display_name, deleted_at FROM users WHERE id = ${target}`;
    expect(row.display_name).toMatch(/^deleted-user-/);
    expect(row.deleted_at).not.toBeNull();
  });
});
