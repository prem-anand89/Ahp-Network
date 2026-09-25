// Phase 4 — the case brief. A write-once templated form the poster fills
// on acceptance, so the accepting therapist has real handoff context
// instead of nothing. NOT the same feature as referral-outcomes.ts's
// "Handover note to the referring therapist" (referral_status_updates.note)
// — that one runs accepter → poster, free text, on outcome report; this
// one runs poster → accepter, four fixed structured fields, once, right
// after acceptance. Deliberately distinct names so the two are never
// confused. Same DI pattern as referral-outcomes.ts (db + userId as
// explicit parameters, testable against a real local Postgres without a
// Supabase session).
//
// No replies, no attachments, no new notification — a message thread was
// considered and rejected (design_analysis.md's in-app messaging
// proposal): it's a second contact channel in a relay-only pilot, the
// largest new privacy surface in the app, and needs moderation/blocking/
// abuse-reporting none of which exist. This is ~80% of the clinical value
// for ~5% of the surface.

import { and, eq, isNull } from "drizzle-orm";
import { homeCaseReferrals } from "@/db/schema";
import { can } from "@/lib/authz";
import { loadAuthzUser } from "@/lib/require-session";
import type { getDb } from "@/db/db";

export type Db = Awaited<ReturnType<typeof getDb>>;

const MAX_FIELD_LENGTH = 300;

export interface CaseBriefInput {
  reasonForReferral: string;
  relevantHistory: string;
  precautions: string;
  preferredContactWindow: string;
  /** Step 7F — "Primary Goal / Expected Outcome," a fifth field so the
   * accepting therapist has a clinical target, not just history. Stored
   * in the same JSONB blob as the other four, so this needed no
   * migration — only a new key and its own length cap, same as the
   * others. */
  expectedGoal: string;
}

export interface CaseBrief extends CaseBriefInput {
  writtenAt: string;
}

const FIELD_LABELS: Record<keyof CaseBriefInput, string> = {
  reasonForReferral: "Reason for referral",
  relevantHistory: "Relevant history",
  precautions: "Precautions",
  preferredContactWindow: "Preferred contact window",
  expectedGoal: "Primary goal / expected outcome",
};

/** Same de-identified-register discipline as patient_summary — this
 * doesn't (and structurally can't) block a therapist typing a name into
 * free text, but every field goes through the same length cap and
 * mandatory-placeholder/inline-warning UI treatment (copy.ts). */
export async function writeCaseBriefTx(
  db: Db,
  userId: string,
  referralId: string,
  input: CaseBriefInput,
): Promise<void> {
  for (const key of Object.keys(FIELD_LABELS) as (keyof CaseBriefInput)[]) {
    const value = input[key]?.trim();
    if (!value) throw new Error(`${FIELD_LABELS[key]} is required`);
    if (value.length > MAX_FIELD_LENGTH) {
      throw new Error(`${FIELD_LABELS[key]} must be ${MAX_FIELD_LENGTH} characters or fewer`);
    }
  }

  const authzUser = await loadAuthzUser(db, userId);

  const [referral] = await db
    .select({
      postedByUserId: homeCaseReferrals.postedByUserId,
      status: homeCaseReferrals.status,
      caseBrief: homeCaseReferrals.caseBrief,
    })
    .from(homeCaseReferrals)
    .where(and(eq(homeCaseReferrals.id, referralId), isNull(homeCaseReferrals.deletedAt)));
  if (!referral) throw new Error("Referral not found");

  const decision = can(authzUser, {
    type: "write_case_brief",
    isPoster: referral.postedByUserId === userId,
    referralStatus: referral.status,
    alreadyWritten: referral.caseBrief != null,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  const trimmed: CaseBriefInput = {
    reasonForReferral: input.reasonForReferral.trim(),
    relevantHistory: input.relevantHistory.trim(),
    precautions: input.precautions.trim(),
    preferredContactWindow: input.preferredContactWindow.trim(),
    expectedGoal: input.expectedGoal.trim(),
  };

  await db
    .update(homeCaseReferrals)
    .set({ caseBrief: trimmed, caseBriefWrittenAt: new Date(), updatedAt: new Date() })
    .where(eq(homeCaseReferrals.id, referralId));
}

/** Who may read the case brief once written: the poster who wrote it, or
 * whichever therapist actually accepted — never the wider matched pool
 * (§8D2's same "matched pool never sees patient_summary free text"
 * discipline applies to this field too, since it can carry the same
 * class of detail). */
export function canViewCaseBrief(isPoster: boolean, isAccepter: boolean): boolean {
  return isPoster || isAccepter;
}
