// Runs against a real local Postgres, never mocks (BUILD_SEQUENCE.md
// Phase 0's test-stack convention) — FOR UPDATE SKIP LOCKED claiming and
// backoff scheduling are database behaviour a mock can't exercise
// honestly.

import { afterEach, afterAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { countClaimableNotifications, processOutboxOnce } from "./notification-outbox-worker";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
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
  const email = `notif-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("processOutboxOnce — §8D notification worker", () => {
  it("claims a pending row, sends it, and marks it sent", async () => {
    // Asserts only on this test's own row, not the global claimed/sent
    // counts — the claim query is deliberately global (any due pending
    // row, across the whole table), so other test files' concurrently-
    // running inserts into the same table are expected company here, same
    // as they would be in production.
    const userId = await createUser();
    const [inserted] = await db
      .insert(schema.notificationOutbox)
      .values({ userId, channel: "push", template: "referral_offered", payload: { referral_id: "test" } })
      .returning();

    const send = vi.fn().mockResolvedValue({ ok: true });
    await processOutboxOnce(db, send);

    const sentIds = send.mock.calls.map(([row]) => row.id);
    expect(sentIds).toContain(inserted.id);

    const [row] = await db.select().from(schema.notificationOutbox).where(eq(schema.notificationOutbox.userId, userId));
    expect(row.status).toBe("sent");
    expect(row.lockedAt).toBeNull();
  });

  it("backs off with an increasing delay on a failed send, without dead-lettering before the max attempts", async () => {
    const userId = await createUser();
    await db.insert(schema.notificationOutbox).values({
      userId,
      channel: "push",
      template: "referral_offered",
      payload: {},
    });

    const send = vi.fn().mockResolvedValue({ ok: false, error: "boom" });
    const result = await processOutboxOnce(db, send);

    expect(result.failed).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(schema.notificationOutbox).where(eq(schema.notificationOutbox.userId, userId));
    expect(row.status).toBe("pending");
    expect(row.attemptCount).toBe(1);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("dead-letters a row after exceeding the max attempt count", async () => {
    const userId = await createUser();
    const [inserted] = await db
      .insert(schema.notificationOutbox)
      .values({ userId, channel: "push", template: "referral_offered", payload: {}, attemptCount: 4 })
      .returning();

    const send = vi.fn().mockResolvedValue({ ok: false, error: "still failing" });
    const result = await processOutboxOnce(db, send);

    expect(result.deadLettered).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(schema.notificationOutbox).where(eq(schema.notificationOutbox.id, inserted.id));
    expect(row.status).toBe("failed");
  });

  it("does not claim a row whose next_attempt_at is in the future", async () => {
    const userId = await createUser();
    const [inserted] = await db
      .insert(schema.notificationOutbox)
      .values({
        userId,
        channel: "push",
        template: "referral_offered",
        payload: {},
        nextAttemptAt: new Date(Date.now() + 60_000),
      })
      .returning();

    const send = vi.fn().mockResolvedValue({ ok: true });
    await processOutboxOnce(db, send);

    expect(send.mock.calls.map(([row]) => row.id)).not.toContain(inserted.id);

    const [row] = await db.select().from(schema.notificationOutbox).where(eq(schema.notificationOutbox.id, inserted.id));
    expect(row.status).toBe("pending");
  });

  it("countClaimableNotifications reflects the pending, due backlog", async () => {
    const userId = await createUser();
    await db.insert(schema.notificationOutbox).values({ userId, channel: "push", template: "x", payload: {} });
    const count = await countClaimableNotifications(db);
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
