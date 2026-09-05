// §8A4 — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { acceptInviteTx, countAcceptedInvites, createInviteTx, InviteRateLimitError } from "./invites";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM invites WHERE inviter_user_id = ${userId} OR accepted_by_user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `invite-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("createInviteTx (§8A4)", () => {
  it("creates an invite with a fresh code", async () => {
    const inviter = await createUser();
    const { code } = await createInviteTx(db, { inviterUserId: inviter, channel: "whatsapp" });
    expect(code).toHaveLength(8);
  });

  it("rejects the 21st invite in a rolling week", async () => {
    const inviter = await createUser();
    for (let i = 0; i < 20; i++) {
      await createInviteTx(db, { inviterUserId: inviter, channel: "whatsapp" });
    }
    await expect(createInviteTx(db, { inviterUserId: inviter, channel: "whatsapp" })).rejects.toThrow(
      InviteRateLimitError,
    );
  });
});

describe("acceptInviteTx + countAcceptedInvites (§8A4/§10H)", () => {
  it("marks the invite accepted and sets the new user's invitedByUserId", async () => {
    const inviter = await createUser();
    const newUser = await createUser();
    const { code } = await createInviteTx(db, { inviterUserId: inviter, channel: "copy_link" });

    await acceptInviteTx(db, code, newUser);

    const [row] = await client`SELECT invited_by_user_id FROM users WHERE id = ${newUser}`;
    expect(row.invited_by_user_id).toBe(inviter);

    const [invite] = await client`SELECT accepted_by_user_id FROM invites WHERE code = ${code}`;
    expect(invite.accepted_by_user_id).toBe(newUser);

    expect(await countAcceptedInvites(db, inviter)).toBe(1);
  });

  it("silently no-ops on an unknown code rather than failing signup", async () => {
    const newUser = await createUser();
    await expect(acceptInviteTx(db, "not-a-real-code", newUser)).resolves.toBeUndefined();
  });
});
