// §8G5 — Team & Roles panel, super_admin only. One account, two contexts:
// promoting a therapist to admin never creates a second account, only an
// admin_users row alongside their existing users row.

import { and, eq, isNull } from "drizzle-orm";
import { adminUserRoles, adminUsers, users } from "@/db/schema";
import type { getDb } from "@/db/db";
import { writeAuditLog } from "./audit";

type Db = Awaited<ReturnType<typeof getDb>>;
export type AdminRoleType =
  | "super_admin"
  | "verification_admin"
  | "grievance_officer"
  | "support_admin"
  | "referral_ops_admin"
  | "technical_admin";

export class LastSuperAdminError extends Error {
  constructor() {
    super("Cannot revoke the last active super_admin");
    this.name = "LastSuperAdminError";
  }
}

export interface AdminListRow {
  adminUserId: string;
  userId: string;
  email: string;
  displayName: string | null;
  activeRoles: { roleAssignmentId: string; role: AdminRoleType }[];
}

export async function listAdmins(db: Db): Promise<AdminListRow[]> {
  const rows = await db
    .select({
      adminUserId: adminUsers.id,
      userId: adminUsers.userId,
      email: users.email,
      displayName: users.displayName,
      roleAssignmentId: adminUserRoles.id,
      role: adminUserRoles.role,
    })
    .from(adminUsers)
    .innerJoin(users, eq(users.id, adminUsers.userId))
    .leftJoin(
      adminUserRoles,
      and(eq(adminUserRoles.adminUserId, adminUsers.id), isNull(adminUserRoles.revokedAt)),
    );

  const byAdmin = new Map<string, AdminListRow>();
  for (const row of rows) {
    let entry = byAdmin.get(row.adminUserId);
    if (!entry) {
      entry = { adminUserId: row.adminUserId, userId: row.userId, email: row.email, displayName: row.displayName, activeRoles: [] };
      byAdmin.set(row.adminUserId, entry);
    }
    if (row.roleAssignmentId && row.role) {
      entry.activeRoles.push({ roleAssignmentId: row.roleAssignmentId, role: row.role });
    }
  }
  return [...byAdmin.values()];
}

/** Resolves a real users.id (e.g. from the Supabase session) to their admin_users.id. */
async function requireAdminUserId(db: Db, actingUserId: string): Promise<string> {
  const [row] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.userId, actingUserId));
  if (!row) throw new Error("Acting user has no admin_users row");
  return row.id;
}

export interface AssignRoleInput {
  /** The acting super_admin's users.id — NOT their admin_users.id. */
  actingUserId: string;
  targetEmail: string;
  role: AdminRoleType;
}

/**
 * Finds the target by email (same identification convention as
 * scripts/bootstrap-admin.mjs), creates their admin_users row if this is
 * their first role, and assigns the role — a no-op if already active.
 */
export async function assignAdminRoleTx(db: Db, input: AssignRoleInput): Promise<void> {
  const actingAdminUserId = await requireAdminUserId(db, input.actingUserId);

  const [targetUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.targetEmail));
  if (!targetUser) {
    throw new Error(`No user with email ${input.targetEmail} — they must sign in at least once first`);
  }

  const [adminUser] = await db
    .insert(adminUsers)
    .values({ userId: targetUser.id })
    .onConflictDoNothing({ target: adminUsers.userId })
    .returning({ id: adminUsers.id });
  const adminUserId = adminUser?.id ?? (await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.userId, targetUser.id)))[0].id;

  const [existingActive] = await db
    .select({ id: adminUserRoles.id })
    .from(adminUserRoles)
    .where(and(eq(adminUserRoles.adminUserId, adminUserId), eq(adminUserRoles.role, input.role), isNull(adminUserRoles.revokedAt)));
  if (existingActive) return;

  await db.insert(adminUserRoles).values({
    adminUserId,
    role: input.role,
    assignedByAdminId: actingAdminUserId,
  });

  await writeAuditLog(db, {
    actorUserId: input.actingUserId,
    actingContext: "admin",
    action: "admin_role_assigned",
    targetTable: "admin_user_roles",
    targetId: adminUserId,
    outcome: "success",
    afterState: { role: input.role },
  });
}

export interface RevokeRoleInput {
  /** The acting super_admin's users.id — NOT their admin_users.id. */
  actingUserId: string;
  roleAssignmentId: string;
}

/**
 * The last-active-super_admin lockout is enforced by a database trigger
 * (drizzle/0003) — this just calls it and translates the trigger's
 * ERRCODE (surfaced on the postgres.js error wrapped inside drizzle's
 * DrizzleQueryError, hence `.cause?.code` rather than `.code`) into a
 * typed error the UI can show a specific message for.
 */
export async function revokeAdminRoleTx(db: Db, input: RevokeRoleInput): Promise<void> {
  const actingAdminUserId = await requireAdminUserId(db, input.actingUserId);

  try {
    await db
      .update(adminUserRoles)
      .set({ revokedAt: new Date(), revokedByAdminId: actingAdminUserId })
      .where(and(eq(adminUserRoles.id, input.roleAssignmentId), isNull(adminUserRoles.revokedAt)));
  } catch (error) {
    const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
    if (code === "AHP99") {
      throw new LastSuperAdminError();
    }
    throw error;
  }

  await writeAuditLog(db, {
    actorUserId: input.actingUserId,
    actingContext: "admin",
    action: "admin_role_revoked",
    targetTable: "admin_user_roles",
    targetId: input.roleAssignmentId,
    outcome: "success",
  });
}
