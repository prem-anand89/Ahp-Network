// [H2] — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { checkLiveness, recordHeartbeat } from "./liveness";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
  await client`DELETE FROM app_settings WHERE key LIKE 'heartbeat:%'`;

  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM notification_outbox WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `liveness-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("checkLiveness (§H2)", () => {
  it("alerts on both jobs when neither has ever recorded a heartbeat", async () => {
    const result = await checkLiveness(db);
    expect(result.healthy).toBe(false);
    expect(result.alerts.map((a) => a.job)).toEqual(
      expect.arrayContaining(["notification_outbox_worker", "referral_scheduler"]),
    );
  });

  it("is healthy when both jobs have a fresh heartbeat and no stale pending notifications", async () => {
    await recordHeartbeat(db, "notification_outbox_worker");
    await recordHeartbeat(db, "referral_scheduler");

    const result = await checkLiveness(db);
    expect(result.healthy).toBe(true);
    expect(result.alerts).toEqual([]);
  });

  it("alerts on a job whose heartbeat exceeds twice its expected interval", async () => {
    await client`
      INSERT INTO app_settings (key, value) VALUES ('heartbeat:notification_outbox_worker', ${JSON.stringify(new Date(Date.now() - 10 * 60 * 1000).toISOString())}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    await recordHeartbeat(db, "referral_scheduler");

    const result = await checkLiveness(db);
    expect(result.healthy).toBe(false);
    expect(result.alerts.some((a) => a.job === "notification_outbox_worker")).toBe(true);
    expect(result.alerts.some((a) => a.job === "referral_scheduler")).toBe(false);
  });

  it("alerts on notification_outbox depth when a pending notification has sat claimable past the stale threshold", async () => {
    await recordHeartbeat(db, "notification_outbox_worker");
    await recordHeartbeat(db, "referral_scheduler");
    const userId = await createUser();
    const staleNextAttempt = new Date(Date.now() - 20 * 60 * 1000);
    await client`
      INSERT INTO notification_outbox (user_id, channel, template, next_attempt_at)
      VALUES (${userId}, 'push', 'referral_offered', ${staleNextAttempt.toISOString()})`;

    const result = await checkLiveness(db);
    expect(result.healthy).toBe(false);
    expect(result.stalePendingNotifications).toBeGreaterThanOrEqual(1);
    expect(result.alerts.some((a) => a.job === "notification_outbox_depth")).toBe(true);
  });
});
