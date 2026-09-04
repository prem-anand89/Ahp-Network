"use server";

// The Phase 3 verification queue's admin actions — Approve / Raise query /
// Reject (plan §8A). [H5] This queue is owned by Phase 3, not Phase 10 —
// Phase 10 only adds it to the admin nav. Gated on manage_curation_queue
// (src/lib/authz.ts) — the same admin habit as the Phase 2 curation
// queues and the Phase 4 practice-claim queue.
//
// Approve/reject are the ONLY two admin actions that ever cause
// verification_stage to move, and they do it exclusively by calling
// recompute_verification_stage(user_id) (drizzle/0010) -- this file never
// writes users.verification_stage or credentials.status directly outside
// that function and the status column update alongside it.

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";
import { can } from "@/lib/authz";
import { credentials, adminUsers } from "@/db/schema";

async function requireVerificationAccess() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) throw new Error("Not signed in");

  const db = await getDb();
  const adminRoles = await getActiveAdminRoles(db, authUser.id);

  const result = can(
    {
      id: authUser.id,
      accountType: "therapist",
      verificationStage: "unverified",
      adminRoles,
      contactDisclosureHoldUntil: null,
    },
    { type: "manage_curation_queue" },
  );
  if (!result.allowed) throw new Error(result.reason);

  const [adminUser] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.userId, authUser.id));

  return { db, adminUserId: adminUser.id };
}

export async function approveCredential(credentialId: string) {
  const { db, adminUserId } = await requireVerificationAccess();

  const [credential] = await db
    .update(credentials)
    .set({ status: "approved", verifiedBy: adminUserId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(credentials.id, credentialId))
    .returning({ userId: credentials.userId });

  // Sync BEFORE recompute so a fresh degree approval is reflected in the
  // profile display at the same moment verification_stage changes.
  await db.execute(sql`SELECT sync_degree_to_course_completion(${credentialId})`);
  await db.execute(sql`SELECT recompute_verification_stage(${credential.userId})`);

  revalidatePath("/admin/verification");
}

export async function rejectCredential(credentialId: string) {
  const { db, adminUserId } = await requireVerificationAccess();

  const [credential] = await db
    .update(credentials)
    .set({ status: "rejected", verifiedBy: adminUserId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(credentials.id, credentialId))
    .returning({ userId: credentials.userId });

  // A rejection can follow a prior approval (re-review) -- recompute
  // either way so a stage that depended on this credential drops correctly.
  await db.execute(sql`SELECT recompute_verification_stage(${credential.userId})`);

  revalidatePath("/admin/verification");
}

export async function raiseCredentialQuery(credentialId: string, message: string) {
  const { db, adminUserId } = await requireVerificationAccess();

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
