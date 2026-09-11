"use server";

// Admin practice-claim review — plan §8C1. Gated via requireAdminAccess.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { practices, practiceClaims, practiceUsers } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";

export async function approvePracticeClaim(claimId: string) {
  const { db, userId, adminUserId } = await requireAdminAccess({ type: "manage_practice_claims" });

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

  await db.insert(practiceUsers).values({
    practiceId: claim.practiceId,
    userId: claim.claimantUserId,
    accessRole: "owner",
    relationshipType: "owns",
    consentStatus: "accepted",
    assertedBy: "self",
    isPublic: true,
  });

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "practice_claim_approved",
    targetTable: "practice_claims",
    targetId: claimId,
    outcome: "success",
    afterState: { status: "approved", practiceId: claim.practiceId },
  });

  revalidatePath("/admin/practice-claims");
}

export async function rejectPracticeClaim(claimId: string, rejectionReason: string) {
  const { db, userId, adminUserId } = await requireAdminAccess({ type: "manage_practice_claims" });

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

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "practice_claim_rejected",
    targetTable: "practice_claims",
    targetId: claimId,
    outcome: "success",
    afterState: { status: "rejected" },
  });

  revalidatePath("/admin/practice-claims");
}

export async function raisePracticeClaimQuery(claimId: string, message: string) {
  const { db, userId, adminUserId } = await requireAdminAccess({ type: "manage_practice_claims" });

  await db
    .update(practiceClaims)
    .set({
      status: "query_raised",
      queryMessage: message,
      reviewedByAdminId: adminUserId,
      updatedAt: new Date(),
    })
    .where(eq(practiceClaims.id, claimId));

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "practice_claim_query_raised",
    targetTable: "practice_claims",
    targetId: claimId,
    outcome: "success",
    afterState: { status: "query_raised" },
  });

  revalidatePath("/admin/practice-claims");
}
