"use server";

// The Phase 3 verification queue's admin actions — Approve / Raise query /
// Reject (plan §8A). Gated via requireAdminAccess (manage_curation_queue).

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { credentials } from "@/db/schema";

export async function approveCredential(credentialId: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "manage_curation_queue" });

  const [credential] = await db
    .update(credentials)
    .set({ status: "approved", verifiedBy: adminUserId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(credentials.id, credentialId))
    .returning({ userId: credentials.userId });

  await db.execute(sql`SELECT sync_degree_to_course_completion(${credentialId})`);
  await db.execute(sql`SELECT recompute_verification_stage(${credential.userId})`);

  revalidatePath("/admin/verification");
}

export async function rejectCredential(credentialId: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "manage_curation_queue" });

  const [credential] = await db
    .update(credentials)
    .set({ status: "rejected", verifiedBy: adminUserId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(credentials.id, credentialId))
    .returning({ userId: credentials.userId });

  await db.execute(sql`SELECT recompute_verification_stage(${credential.userId})`);

  revalidatePath("/admin/verification");
}

export async function raiseCredentialQuery(credentialId: string, message: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "manage_curation_queue" });

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

  revalidatePath("/admin/verification");
}
