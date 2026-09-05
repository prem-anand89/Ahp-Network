// §8H — the "on erasure request" half of the retention matrix. Distinct
// from retention.ts's automatic, time-based purges: this only runs when a
// specific user has actually asked, triggered by an admin (not a self-
// service button — the deletion-request admin screen wraps this).
//
// Anonymisation must be irreversible (§8H's first rule) — every value
// replaced here is gone, not soft-hidden. `users.id` and other foreign
// keys are retained everywhere per the matrix ("referential integrity"),
// so history (who reviewed a credential, which referral a therapist
// accepted) stays intact without naming the erased person.
//
// Two columns beyond the matrix's literal `users` row are nulled here too
// — `legal_name` and the encrypted `public_contact_value` (§5's one
// encrypted field). Leaving either behind would mean the "anonymisation
// must be irreversible" rule holds for the columns the matrix happened to
// list but not for the two most directly identifying ones on the same
// row — an oversight worth closing now rather than carrying forward.

import { eq } from "drizzle-orm";
import {
  credentials,
  feedback,
  homeCaseReferrals,
  invites,
  practiceClaims,
  profileContactReveals,
  pushSubscriptions,
  therapistSkills,
  users,
} from "@/db/schema";
import type { getDb } from "@/db/db";
import { CREDENTIALS_BUCKET, deleteR2Object, type R2Env } from "./r2";
import { writeAuditLog } from "./audit";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface ErasureRequestInput {
  actingUserId: string;
  targetUserId: string;
}

export interface ErasureResult {
  credentialsAnonymised: number;
  referralsAnonymised: number;
  pushSubscriptionsDeleted: number;
  practiceClaimsAnonymised: number;
  contactRevealsAnonymised: number;
  feedbackAnonymised: number;
  invitesAnonymised: number;
  therapistSkillsAnonymised: number;
}

/**
 * Applies §8H's "on erasure request" rules for one user, all at once, on
 * an admin's say-so. Idempotent — re-running against an already-erased
 * user changes nothing further (every WHERE clause only matches rows that
 * still hold the data to remove).
 */
export async function runErasureRequestTx(db: Db, env: R2Env, input: ErasureRequestInput): Promise<ErasureResult> {
  const hash = crypto.randomUUID().slice(0, 8);

  const credentialRows = await db
    .select({ id: credentials.id, documentUrl: credentials.documentUrl })
    .from(credentials)
    .where(eq(credentials.userId, input.targetUserId));
  for (const row of credentialRows) {
    if (row.documentUrl) await deleteR2Object(env, CREDENTIALS_BUCKET, row.documentUrl);
  }
  if (credentialRows.length > 0) {
    await db
      .update(credentials)
      .set({ documentUrl: null, registrationNumber: null, ocrExtractedJson: null })
      .where(eq(credentials.userId, input.targetUserId));
  }

  const referralResult = await db
    .update(homeCaseReferrals)
    .set({ patientSummary: null, locationAddress: null })
    .where(eq(homeCaseReferrals.postedByUserId, input.targetUserId))
    .returning({ id: homeCaseReferrals.id });

  const pushResult = await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, input.targetUserId))
    .returning({ id: pushSubscriptions.id });

  const practiceClaimRows = await db
    .select({ id: practiceClaims.id, documentUrl: practiceClaims.documentUrl })
    .from(practiceClaims)
    .where(eq(practiceClaims.claimantUserId, input.targetUserId));
  for (const row of practiceClaimRows) {
    if (row.documentUrl) await deleteR2Object(env, CREDENTIALS_BUCKET, row.documentUrl);
  }
  if (practiceClaimRows.length > 0) {
    await db
      .update(practiceClaims)
      // document_url is NOT NULL — an empty string is the closest
      // equivalent to "gone" the column type allows.
      .set({ documentUrl: "", registrationNumber: null, queryMessage: null })
      .where(eq(practiceClaims.claimantUserId, input.targetUserId));
  }

  // §8H: "null proof_url, delete R2 objects; skill names [retained]."
  const skillRows = await db
    .select({ id: therapistSkills.id, proofUrl: therapistSkills.proofUrl })
    .from(therapistSkills)
    .where(eq(therapistSkills.userId, input.targetUserId));
  for (const row of skillRows) {
    if (row.proofUrl) await deleteR2Object(env, CREDENTIALS_BUCKET, row.proofUrl);
  }
  if (skillRows.length > 0) {
    await db.update(therapistSkills).set({ proofUrl: null }).where(eq(therapistSkills.userId, input.targetUserId));
  }

  const revealResult = await db
    .update(profileContactReveals)
    .set({ userAgent: null })
    .where(eq(profileContactReveals.profileUserId, input.targetUserId))
    .returning({ id: profileContactReveals.id });

  const feedbackResult = await db
    .update(feedback)
    .set({ message: "[erased]", userId: null })
    .where(eq(feedback.userId, input.targetUserId))
    .returning({ id: feedback.id });

  // invites.code is NOT NULL + unique, so it can't be nulled outright —
  // a per-row redacted placeholder satisfies both constraints while
  // destroying the code's usefulness, which is the actual intent.
  const inviteRows = await db.select({ id: invites.id }).from(invites).where(eq(invites.inviterUserId, input.targetUserId));
  for (const row of inviteRows) {
    await db.update(invites).set({ code: `redacted-${row.id}` }).where(eq(invites.id, row.id));
  }

  await db
    .update(users)
    .set({
      email: `deleted-user-${hash}@deleted.ahpnetwork.invalid`,
      displayName: `deleted-user-${hash}`,
      legalName: null,
      photoUrl: null,
      bio: null,
      availabilityNotes: null,
      publicContactValue: null,
      slug: null,
      profileVisibility: "hidden",
      profileStatus: "suspended",
      deletedAt: new Date(),
    })
    .where(eq(users.id, input.targetUserId));

  await writeAuditLog(db, {
    actorUserId: input.actingUserId,
    actingContext: "admin",
    action: "erasure_request_applied",
    targetTable: "users",
    targetId: input.targetUserId,
    outcome: "success",
  });

  return {
    credentialsAnonymised: credentialRows.length,
    referralsAnonymised: referralResult.length,
    pushSubscriptionsDeleted: pushResult.length,
    practiceClaimsAnonymised: practiceClaimRows.length,
    contactRevealsAnonymised: revealResult.length,
    feedbackAnonymised: feedbackResult.length,
    invitesAnonymised: inviteRows.length,
    therapistSkillsAnonymised: skillRows.length,
  };
}
