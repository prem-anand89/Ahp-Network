"use server";

// Team & Roles panel — §8G5, super_admin only.

import { revalidatePath } from "next/cache";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { assignAdminRoleTx, revokeAdminRoleTx, LastSuperAdminError, type AdminRoleType } from "@/lib/admin-roles";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function assignRoleAction(targetEmail: string, role: AdminRoleType): Promise<ActionResult> {
  const { db, userId } = await requireAdminAccess({ type: "manage_admin_roles" });
  try {
    await assignAdminRoleTx(db, { actingUserId: userId, targetEmail, role });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to assign role" };
  }
  revalidatePath("/admin/team-roles");
  return { ok: true };
}

export async function revokeRoleAction(roleAssignmentId: string): Promise<ActionResult> {
  const { db, userId } = await requireAdminAccess({ type: "manage_admin_roles" });
  try {
    await revokeAdminRoleTx(db, { actingUserId: userId, roleAssignmentId });
  } catch (error) {
    if (error instanceof LastSuperAdminError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: error instanceof Error ? error.message : "Failed to revoke role" };
  }
  revalidatePath("/admin/team-roles");
  return { ok: true };
}
