"use server";

// The dedicated grievance queue — §8G5. grievance_officer or super_admin.

import { revalidatePath } from "next/cache";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { acknowledgeGrievanceTx, resolveGrievanceTx } from "@/lib/feedback";

export async function acknowledgeGrievance(feedbackId: string) {
  const { db, userId } = await requireAdminAccess({ type: "manage_grievance" });
  await acknowledgeGrievanceTx(db, { actingUserId: userId, feedbackId });
  revalidatePath("/admin/grievance");
}

export async function resolveGrievance(feedbackId: string, adminNotes: string) {
  const { db, userId } = await requireAdminAccess({ type: "manage_grievance" });
  await resolveGrievanceTx(db, { actingUserId: userId, feedbackId, adminNotes: adminNotes || undefined });
  revalidatePath("/admin/grievance");
}
