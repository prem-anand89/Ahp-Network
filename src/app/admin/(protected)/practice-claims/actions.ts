"use server";

// Admin practice-claim review — plan §8C1. Reuses the same admin habit as
// the Phase 3 credential queue (Approve / Raise query / Reject), gated on
// manage_practice_claims (src/lib/authz.ts).

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";
import { can } from "@/lib/authz";
import { practices, practiceClaims, practiceUsers, adminUsers } from "@/db/schema";

async function requirePracticeClaimAccess() {
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
    { type: "manage_practice_claims" },
  );
  if (!result.allowed) throw new Error(result.reason);

  const [adminUser] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.userId, authUser.id));

  return { db, adminUserId: adminUser.id };
}

/**
 * §8C1: "On approval: claimant gets practice_users with access_role =
 * 'owner', owner-only fields unlock, noindex clears, claim_status =
 * 'claimed'." A disputed practice can also be resolved this way — approving
 * one of the two contesting claims moves the practice out of 'disputed'.
 */
export async function approvePracticeClaim(claimId: string) {
  const { db, adminUserId } = await requirePracticeClaimAccess();

  const [claim] = await db
    .update(practiceClaims)
    .set({ status: "approved", reviewedByAdminId: adminUserId, reviewedAt: new Date(), updatedAt: new Date() })
    .where(eq(practiceClaims.id, claimId))
    .returning({ practiceId: practiceClaims.practiceId, claimantUserId: practiceClaims.claimantUserId });

  await db
    .update(practices)
    .set({
      claimStatus: "claimed",
      claimedByUserId: claim.claimantUserId,
      claimedAt: new Date(),
      noindex: false,
      updatedAt: new Date(),
    })
    .where(eq(practices.id, claim.practiceId));

  // The claimant already has a 'staff'/works_at row if they created the
  // practice themselves; a claimant who didn't create it gets a fresh
  // owner affiliation here. Either way, ownership itself is a distinct
  // access_role row, not a mutation of any existing works_at row.
  await db.insert(practiceUsers).values({
    practiceId: claim.practiceId,
    userId: claim.claimantUserId,
    accessRole: "owner",
    relationshipType: "owns",
    consentStatus: "accepted",
    assertedBy: "self",
    isPublic: true,
  });

  revalidatePath("/admin/practice-claims");
}

export async function rejectPracticeClaim(claimId: string, rejectionReason: string) {
  const { db, adminUserId } = await requirePracticeClaimAccess();

  await db
    .update(practiceClaims)
    .set({
      status: "rejected",
      rejectionReason,
      reviewedByAdminId: adminUserId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(practiceClaims.id, claimId));

  revalidatePath("/admin/practice-claims");
}

export async function raisePracticeClaimQuery(claimId: string, message: string) {
  const { db, adminUserId } = await requirePracticeClaimAccess();

  await db
    .update(practiceClaims)
    .set({
      status: "query_raised",
      queryMessage: message,
      reviewedByAdminId: adminUserId,
      updatedAt: new Date(),
    })
    .where(eq(practiceClaims.id, claimId));

  revalidatePath("/admin/practice-claims");
}
