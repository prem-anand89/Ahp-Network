"use server";

// The Phase 3 verification queue's admin actions — Approve / Raise query /
// Reject (plan §8A). Gated via requireAdminAccess (manage_curation_queue).

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { credentials } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";

export async function approveCredential(credentialId: string) {
  const { db, userId, adminUserId } = await requireAdminAccess({ type: "manage_curation_queue" });

  const [credential] = await db
    .update(credentials)
    .set({ status: "approved", verifiedBy: adminUserId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(credentials.id, credentialId))
    .returning({ userId: credentials.userId });

  await db.execute(sql`SELECT sync_degree_to_course_completion(${credentialId})`);
  await db.execute(sql`SELECT recompute_verification_stage(${credential.userId})`);

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "credential_approved",
    targetTable: "credentials",
    targetId: credentialId,
    outcome: "success",
    afterState: { status: "approved" },
  });

  revalidatePath("/admin/verification");
}

export async function rejectCredential(credentialId: string) {
  const { db, userId, adminUserId } = await requireAdminAccess({ type: "manage_curation_queue" });

  const [credential] = await db
    .update(credentials)
    .set({ status: "rejected", verifiedBy: adminUserId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(credentials.id, credentialId))
    .returning({ userId: credentials.userId });

  await db.execute(sql`SELECT recompute_verification_stage(${credential.userId})`);

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "credential_rejected",
    targetTable: "credentials",
    targetId: credentialId,
    outcome: "success",
    afterState: { status: "rejected" },
  });

  revalidatePath("/admin/verification");
}

export async function raiseCredentialQuery(credentialId: string, message: string) {
  const { db, userId, adminUserId } = await requireAdminAccess({ type: "manage_curation_queue" });

  await db
    .update(credentials)
    .set({
      status: "query_raised",
      queryMessage: message,
      queryRaisedAt: new Date(),
      queryRaisedByAdminId: adminUserId,
      updatedAt: new Date(),
    })
    .where(eq(credentials.id, credentialId));

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "credential_query_raised",
    targetTable: "credentials",
    targetId: credentialId,
    outcome: "success",
    // No raw PII, per audit.ts's discipline — a change-happened marker,
    // not the query text itself.
    afterState: { status: "query_raised" },
  });

  revalidatePath("/admin/verification");
}
