"use server";

// Feedback triage backlog, excluding grievance — §8G3, support_admin or
// super_admin.

import { revalidatePath } from "next/cache";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { updateFeedbackStatusTx, type FeedbackStatus } from "@/lib/feedback";

export async function updateFeedbackStatus(feedbackId: string, status: FeedbackStatus, adminNotes: string) {
  const { db, userId } = await requireAdminAccess({ type: "manage_feedback" });
  await updateFeedbackStatusTx(db, { actingUserId: userId, feedbackId, status, adminNotes: adminNotes || undefined });
  revalidatePath("/admin/feedback");
}
