// §8E2 — runs against a real local Postgres, never mocks. Every mutation
// is owner-scoped at the query level, so the tests exercise both the
// happy path and the cross-owner rejection directly, not just the schema.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  addCircleMember,
  createCircle,
  deleteCircle,
  findTherapistIdBySlug,
  getCircle,
  listCircleMembers,
  listCircles,
  removeCircleMember,
  renameCircle,
} from "./circles";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM circle_members WHERE therapist_user_id = ${userId}`;
    await client`DELETE FROM circles WHERE owner_user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(slug?: string): Promise<string> {
  const email = `circles-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type, slug) VALUES (${authUser.id}, ${email}, 'therapist', ${slug ?? null})`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("circles", () => {
  it("creates a circle and lists it with a zero member count", async () => {
    const ownerId = await createUser();
    await createCircle(db, ownerId, "Trusted Home-Visit Therapists");

    const rows = await listCircles(db, ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Trusted Home-Visit Therapists");
    expect(rows[0].memberCount).toBe(0);
  });

  it("rejects an empty circle name", async () => {
    const ownerId = await createUser();
    await expect(createCircle(db, ownerId, "   ")).rejects.toThrow("Circle name is required");
  });

  it("renames a circle it owns", async () => {
    const ownerId = await createUser();
    const circle = await createCircle(db, ownerId, "Original");
    await renameCircle(db, ownerId, circle.id, "Renamed");

    const found = await getCircle(db, ownerId, circle.id);
    expect(found.name).toBe("Renamed");
  });

  it("never lets one owner mutate another owner's circle", async () => {
    const ownerId = await createUser();
    const otherOwnerId = await createUser();
    const circle = await createCircle(db, ownerId, "Mine");

    await expect(renameCircle(db, otherOwnerId, circle.id, "Hijacked")).rejects.toThrow("Circle not found");
    await expect(deleteCircle(db, otherOwnerId, circle.id)).rejects.toThrow("Circle not found");
    await expect(getCircle(db, otherOwnerId, circle.id)).rejects.toThrow("Circle not found");
  });

  it("soft-deletes a circle so it drops out of the owner's list", async () => {
    const ownerId = await createUser();
    const circle = await createCircle(db, ownerId, "Temporary");
    await deleteCircle(db, ownerId, circle.id);

    const rows = await listCircles(db, ownerId);
    expect(rows).toHaveLength(0);
  });

  it("adds and lists a member, silently — no notification_outbox row", async () => {
    const ownerId = await createUser();
    const memberId = await createUser();
    const circle = await createCircle(db, ownerId, "Neuro Referrals");

    await addCircleMember(db, ownerId, circle.id, memberId);

    const members = await listCircleMembers(db, ownerId, circle.id);
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(memberId);

    const [{ count }] = await client<{ count: string }[]>`
      SELECT count(*)::int AS count FROM notification_outbox WHERE user_id = ${memberId}`;
    expect(Number(count)).toBe(0);
  });

  it("adding the same member twice does not duplicate or error", async () => {
    const ownerId = await createUser();
    const memberId = await createUser();
    const circle = await createCircle(db, ownerId, "Dupe test");

    await addCircleMember(db, ownerId, circle.id, memberId);
    await addCircleMember(db, ownerId, circle.id, memberId);

    const members = await listCircleMembers(db, ownerId, circle.id);
    expect(members).toHaveLength(1);
  });

  it("removes a member", async () => {
    const ownerId = await createUser();
    const memberId = await createUser();
    const circle = await createCircle(db, ownerId, "Removable");
    await addCircleMember(db, ownerId, circle.id, memberId);

    await removeCircleMember(db, ownerId, circle.id, memberId);

    const members = await listCircleMembers(db, ownerId, circle.id);
    expect(members).toHaveLength(0);
  });

  it("finds a therapist by their profile slug", async () => {
    const slug = `therapist-${crypto.randomUUID()}`;
    const userId = await createUser(slug);

    const found = await findTherapistIdBySlug(db, slug);
    expect(found).toBe(userId);
  });

  it("returns null for a slug that does not exist", async () => {
    const found = await findTherapistIdBySlug(db, "no-such-slug");
    expect(found).toBeNull();
  });
});
