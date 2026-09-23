// Real local Postgres, same convention as the other notification tests.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { isChannelEnabled, listPreferences, setPreference } from "./notification-preferences";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM notification_preferences WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `pref-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("notification preferences", () => {
  it("defaults to enabled with no row present", async () => {
    const userId = await createUser();
    expect(await isChannelEnabled(db, userId, "referral_posted_match", "push")).toBe(true);
  });

  it("setPreference writes a disable, isChannelEnabled reflects it", async () => {
    const userId = await createUser();
    await setPreference(db, userId, "referral_posted_match", "push", false);
    expect(await isChannelEnabled(db, userId, "referral_posted_match", "push")).toBe(false);
    // A different (event_type, channel) pair for the same user is unaffected.
    expect(await isChannelEnabled(db, userId, "referral_posted_match", "email")).toBe(true);
  });

  it("setPreference is idempotent — a second call updates the same row rather than inserting a duplicate", async () => {
    const userId = await createUser();
    await setPreference(db, userId, "weekly_digest", "email", false);
    await setPreference(db, userId, "weekly_digest", "email", true);

    const rows = await listPreferences(db, userId);
    const matching = rows.filter((r) => r.eventType === "weekly_digest" && r.channel === "email");
    expect(matching).toHaveLength(1);
    expect(matching[0].enabled).toBe(true);
  });
});
