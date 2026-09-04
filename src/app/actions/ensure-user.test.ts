// Runs against real local Postgres, never mocks — per BUILD_SEQUENCE.md's
// test-stack convention. db is a plain drizzle client here rather than the
// real getDb() (which needs a Cloudflare Workers context); the function
// under test takes db as a parameter for exactly this reason.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { ensureUserAndIdentities } from "./ensure-user";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(connectionString, { prepare: false, max: 2 });
const db = drizzle(client, { schema });

async function seedAuthUser(id: string, email: string) {
  await client`INSERT INTO auth.users (id, email) VALUES (${id}, ${email})`;
}

async function cleanup(id: string) {
  await db.delete(schema.authIdentities).where(eq(schema.authIdentities.userId, id));
  await db.delete(schema.users).where(eq(schema.users.id, id));
  await client`DELETE FROM auth.users WHERE id = ${id}`;
}

afterAll(async () => {
  await client.end();
});

describe("ensureUserAndIdentities (§8A, §10A)", () => {
  const testId = "11111111-1111-1111-1111-111111111111";

  beforeEach(async () => {
    await cleanup(testId).catch(() => {});
  });

  it("creates a users row on first sign-in with the expected defaults", async () => {
    await seedAuthUser(testId, "new-user@example.com");
    await ensureUserAndIdentities(db, {
      id: testId,
      email: "new-user@example.com",
      identities: [{ provider: "google", id: "google-sub-123" }],
    });

    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, testId));
    expect(row.email).toBe("new-user@example.com");
    expect(row.accountType).toBe("therapist");
    expect(row.isFoundingMember).toBe(true);

    const identities = await db
      .select()
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.userId, testId));
    expect(identities).toHaveLength(1);
    expect(identities[0].provider).toBe("google");
    expect(identities[0].providerAccountId).toBe("google-sub-123");

    await cleanup(testId);
  });

  it("is idempotent — calling it again does not duplicate the users row or identity", async () => {
    await seedAuthUser(testId, "repeat-user@example.com");
    const authUser = {
      id: testId,
      email: "repeat-user@example.com",
      identities: [{ provider: "email", id: testId }],
    };

    await ensureUserAndIdentities(db, authUser);
    await ensureUserAndIdentities(db, authUser);

    const rows = await db.select().from(schema.users).where(eq(schema.users.id, testId));
    expect(rows).toHaveLength(1);

    const identities = await db
      .select()
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.userId, testId));
    expect(identities).toHaveLength(1);

    await cleanup(testId);
  });

  it("throws rather than creating a row with no email", async () => {
    await expect(ensureUserAndIdentities(db, { id: testId, identities: [] })).rejects.toThrow(
      /without an email/,
    );
  });

  it("§8A4 — links invitedByUserId on first insert when a valid ref code is passed", async () => {
    const inviterId = "33333333-3333-3333-3333-333333333333";
    await cleanup(inviterId).catch(() => {});
    await seedAuthUser(inviterId, "inviter@example.com");
    await db.insert(schema.users).values({ id: inviterId, email: "inviter@example.com", accountType: "therapist" });
    const [invite] = await db
      .insert(schema.invites)
      .values({ inviterUserId: inviterId, code: "reftestcode", channel: "whatsapp" })
      .returning({ code: schema.invites.code });

    await seedAuthUser(testId, "invitee@example.com");
    await ensureUserAndIdentities(
      db,
      { id: testId, email: "invitee@example.com", identities: [] },
      invite.code,
    );

    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, testId));
    expect(row.invitedByUserId).toBe(inviterId);

    await db.delete(schema.invites).where(eq(schema.invites.inviterUserId, inviterId));
    await cleanup(testId);
    await cleanup(inviterId);
  });
});
