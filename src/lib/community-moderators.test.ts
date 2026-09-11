// §8E3 — self-nomination + admin approval, revocable by super_admin,
// never re-votable. Runs against real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  applyForModeratorTx,
  approveModeratorTx,
  isApprovedModerator,
  listPendingModeratorApplications,
  revokeModeratorTx,
} from "./community-moderators";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdCommunityIds: string[] = [];
const createdAdminUserIds: string[] = [];

afterEach(async () => {
  // community_moderators rows (which reference admin_users via
  // reviewed_by_admin_id/revoked_by_admin_id) must be gone before the
  // admin_users rows they reference are deleted.
  let communityId: string | undefined;
  while ((communityId = createdCommunityIds.pop()) !== undefined) {
    await client`DELETE FROM community_moderators WHERE community_id = ${communityId}`;
    await client`DELETE FROM communities WHERE id = ${communityId}`;
  }
  let adminUserId: string | undefined;
  while ((adminUserId = createdAdminUserIds.pop()) !== undefined) {
    await client`DELETE FROM admin_users WHERE id = ${adminUserId}`;
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

async function createUser(): Promise<string> {
  const email = `moderator-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function createAdminUser(userId: string): Promise<string> {
  const [row] = await client<{ id: string }[]>`INSERT INTO admin_users (user_id) VALUES (${userId}) RETURNING id`;
  createdAdminUserIds.push(row.id);
  return row.id;
}

async function createInstitutionCommunity(): Promise<string> {
  const [institution] = await client<{ id: string }[]>`
    INSERT INTO master_institutions (name, normalized_name) VALUES (${"Institute " + crypto.randomUUID()}, 'x') RETURNING id`;
  const [community] = await client<{ id: string }[]>`
    INSERT INTO communities (name, slug, origin, source_institution_id)
    VALUES ('Institute Alumni', ${`inst-${crypto.randomUUID()}`}, 'auto_generated_institution', ${institution.id})
    RETURNING id`;
  createdCommunityIds.push(community.id);
  return community.id;
}

describe("community moderators (§8E3)", () => {
  it("applying twice does not create two rows", async () => {
    const communityId = await createInstitutionCommunity();
    const applicant = await createUser();

    await applyForModeratorTx(db, communityId, applicant);
    await applyForModeratorTx(db, communityId, applicant);

    const rows = await client`SELECT * FROM community_moderators WHERE community_id = ${communityId} AND user_id = ${applicant}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("appears in the pending-applications queue until reviewed", async () => {
    const communityId = await createInstitutionCommunity();
    const applicant = await createUser();
    await applyForModeratorTx(db, communityId, applicant);

    const pending = await listPendingModeratorApplications(db);
    expect(pending.some((p) => p.communityId === communityId && p.userId === applicant)).toBe(true);
  });

  it("approval grants moderator status", async () => {
    const communityId = await createInstitutionCommunity();
    const applicant = await createUser();
    const adminUser = await createUser();
    const adminUserId = await createAdminUser(adminUser);

    await applyForModeratorTx(db, communityId, applicant);
    const [{ id: rowId }] = await client<{ id: string }[]>`
      SELECT id FROM community_moderators WHERE community_id = ${communityId} AND user_id = ${applicant}`;

    expect(await isApprovedModerator(db, communityId, applicant)).toBe(false);
    await approveModeratorTx(db, rowId, adminUserId);
    expect(await isApprovedModerator(db, communityId, applicant)).toBe(true);
  });

  it("revocation is terminal — a re-application gets a fresh row, not the old one resurrected", async () => {
    const communityId = await createInstitutionCommunity();
    const applicant = await createUser();
    const adminUser = await createUser();
    const adminUserId = await createAdminUser(adminUser);

    await applyForModeratorTx(db, communityId, applicant);
    const [{ id: rowId }] = await client<{ id: string }[]>`
      SELECT id FROM community_moderators WHERE community_id = ${communityId} AND user_id = ${applicant}`;
    await approveModeratorTx(db, rowId, adminUserId);
    await revokeModeratorTx(db, rowId, adminUserId);

    expect(await isApprovedModerator(db, communityId, applicant)).toBe(false);

    // Applying again succeeds (the revoked row doesn't block a new one —
    // it's excluded from the partial unique index).
    await applyForModeratorTx(db, communityId, applicant);
    const rows = await client`SELECT * FROM community_moderators WHERE community_id = ${communityId} AND user_id = ${applicant}`;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "revoked")).toHaveLength(1);
  });
});
