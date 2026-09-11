// Profile Card addendum — computeAvailabilityDisplay is pure (no DB), so
// most of these run without Postgres. setAvailabilityTx runs against a
// real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { computeAvailabilityDisplay, setAvailabilityTx } from "./availability";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
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
  const email = `availability-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("computeAvailabilityDisplay", () => {
  it("is not_stated when the timestamp is null, regardless of the boolean", () => {
    expect(computeAvailabilityDisplay(false, null).kind).toBe("not_stated");
    // The column defaults to false, so a never-touched row must never read
    // as an explicit "not accepting" — that would put words in someone's
    // mouth they never said.
    expect(computeAvailabilityDisplay(true, null).kind).toBe("not_stated");
  });

  it("is not_accepting when explicitly set to false with a real timestamp", () => {
    const result = computeAvailabilityDisplay(false, new Date());
    expect(result.kind).toBe("not_accepting");
  });

  it("is available_fresh within the 30-day window", () => {
    const result = computeAvailabilityDisplay(true, new Date(Date.now() - 5 * 24 * 60 * 60 * 1000));
    expect(result.kind).toBe("available_fresh");
  });

  it("is available_stale past the 30-day window", () => {
    const result = computeAvailabilityDisplay(true, new Date(Date.now() - 45 * 24 * 60 * 60 * 1000));
    expect(result.kind).toBe("available_stale");
  });
});

describe("setAvailabilityTx", () => {
  it("writes both the boolean and the timestamp together", async () => {
    const userId = await createUser();
    await setAvailabilityTx(db, userId, true);

    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(row.availableForNewPatients).toBe(true);
    expect(row.availabilityUpdatedAt).not.toBeNull();
  });

  it("refreshes the timestamp on every call, even flipping to the same value", async () => {
    const userId = await createUser();
    await setAvailabilityTx(db, userId, true);
    const [first] = await db.select().from(schema.users).where(eq(schema.users.id, userId));

    await new Promise((resolve) => setTimeout(resolve, 10));
    await setAvailabilityTx(db, userId, true);
    const [second] = await db.select().from(schema.users).where(eq(schema.users.id, userId));

    expect(second.availabilityUpdatedAt!.getTime()).toBeGreaterThan(first.availabilityUpdatedAt!.getTime());
  });
});
