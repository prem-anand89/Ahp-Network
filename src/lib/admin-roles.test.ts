// §8G5 — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { assignAdminRoleTx, LastSuperAdminError, listAdmins, revokeAdminRoleTx } from "./admin-roles";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM audit_logs WHERE actor_user_id = ${userId}`;
    await client`DELETE FROM admin_user_roles WHERE admin_user_id IN (SELECT id FROM admin_users WHERE user_id = ${userId})`;
    await client`DELETE FROM admin_users WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(email: string): Promise<string> {
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function makeSuperAdmin(email: string): Promise<{ userId: string; adminUserId: string; roleAssignmentId: string }> {
  const userId = await createUser(email);
  const [adminUser] = await client`INSERT INTO admin_users (user_id) VALUES (${userId}) RETURNING id`;
  const [role] = await client`INSERT INTO admin_user_roles (admin_user_id, role) VALUES (${adminUser.id}, 'super_admin') RETURNING id`;
  return { userId, adminUserId: adminUser.id, roleAssignmentId: role.id };
}

describe("assignAdminRoleTx (§8G5)", () => {
  it("creates an admin_users row for a first-time admin and assigns the role", async () => {
    const assigner = await makeSuperAdmin("assigner1@test.local");
    const targetEmail = `target-${crypto.randomUUID()}@test.local`;
    await createUser(targetEmail);

    await assignAdminRoleTx(db, { actingUserId: assigner.userId, targetEmail, role: "verification_admin" });

    const admins = await listAdmins(db);
    const target = admins.find((a) => a.email === targetEmail);
    expect(target?.activeRoles.map((r) => r.role)).toContain("verification_admin");
  });

  it("writes an audit log entry", async () => {
    const assigner = await makeSuperAdmin("assigner2@test.local");
    const targetEmail = `target-${crypto.randomUUID()}@test.local`;
    await createUser(targetEmail);

    await assignAdminRoleTx(db, { actingUserId: assigner.userId, targetEmail, role: "support_admin" });

    const [log] = await client`SELECT action FROM audit_logs WHERE actor_user_id = ${assigner.userId} AND action = 'admin_role_assigned'`;
    expect(log.action).toBe("admin_role_assigned");
  });

  it("throws for an email with no users row", async () => {
    const assigner = await makeSuperAdmin("assigner3@test.local");
    await expect(
      assignAdminRoleTx(db, { actingUserId: assigner.userId, targetEmail: "nobody@test.local", role: "support_admin" }),
    ).rejects.toThrow(/sign in at least once/);
  });

  it("is a no-op when the role is already active", async () => {
    const assigner = await makeSuperAdmin("assigner4@test.local");
    const targetEmail = `target-${crypto.randomUUID()}@test.local`;
    await createUser(targetEmail);

    await assignAdminRoleTx(db, { actingUserId: assigner.userId, targetEmail, role: "support_admin" });
    await assignAdminRoleTx(db, { actingUserId: assigner.userId, targetEmail, role: "support_admin" });

    const admins = await listAdmins(db);
    const target = admins.find((a) => a.email === targetEmail);
    expect(target?.activeRoles.filter((r) => r.role === "support_admin")).toHaveLength(1);
  });
});

describe("revokeAdminRoleTx (§8G5 — last-super-admin lockout)", () => {
  it("revokes a non-last role and writes an audit log entry", async () => {
    const superAdmin = await makeSuperAdmin("solesuper1@test.local");
    const targetEmail = `target-${crypto.randomUUID()}@test.local`;
    await createUser(targetEmail);
    await assignAdminRoleTx(db, { actingUserId: superAdmin.userId, targetEmail, role: "support_admin" });
    const admins = await listAdmins(db);
    const assignment = admins.find((a) => a.email === targetEmail)?.activeRoles[0];

    await revokeAdminRoleTx(db, { actingUserId: superAdmin.userId, roleAssignmentId: assignment!.roleAssignmentId });

    const [row] = await client`SELECT revoked_at FROM admin_user_roles WHERE id = ${assignment!.roleAssignmentId}`;
    expect(row.revoked_at).not.toBeNull();

    const [log] = await client`SELECT action FROM audit_logs WHERE actor_user_id = ${superAdmin.userId} AND action = 'admin_role_revoked'`;
    expect(log.action).toBe("admin_role_revoked");
  });

  it("blocks revoking the last active super_admin", async () => {
    const superAdmin = await makeSuperAdmin("solesuper2@test.local");

    await expect(
      revokeAdminRoleTx(db, { actingUserId: superAdmin.userId, roleAssignmentId: superAdmin.roleAssignmentId }),
    ).rejects.toThrow(LastSuperAdminError);
  });
});
