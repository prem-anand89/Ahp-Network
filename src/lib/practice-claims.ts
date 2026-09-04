// §8C1's contested-claim handling, extracted from the server action so it
// can be tested directly against a real Postgres transaction (same
// pattern as src/lib/ocr/process-credential.ts being separate from its
// "use server" wrapper).
//
// Application-level transaction — NOT one of CLAUDE.md's three referral
// PL/pgSQL functions (that rule is scoped specifically to
// shortlist_referral/accept_referral/lapse_offers). Locks the practice row
// so two near-simultaneous claims from different claimants can't both see
// 'unclaimed'. NEVER resolved first-come: a second, different claimant's
// claim always freezes the record as 'disputed' and escalates to admin
// review, rather than one silently winning a race.

import { eq, sql } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { practices, practiceClaims } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface SubmitPracticeClaimInput {
  practiceId: string;
  claimantUserId: string;
  claimedRelationship: "owner" | "manager";
  documentUrl: string;
  registrationNumber?: string;
}

export interface SubmitPracticeClaimResult {
  id: string;
  disputed: boolean;
}

export async function submitPracticeClaimTx(
  db: Db,
  input: SubmitPracticeClaimInput,
): Promise<SubmitPracticeClaimResult> {
  return db.transaction(async (tx) => {
    const [practice] = await tx
      .select()
      .from(practices)
      .where(eq(practices.id, input.practiceId))
      .for("update");

    if (!practice) throw new Error("Practice not found");

    if (practice.claimStatus === "claimed") {
      throw new Error("This practice has already been claimed");
    }
    if (practice.claimStatus === "disputed") {
      throw new Error("This practice's ownership is under dispute and frozen for new claims");
    }

    if (practice.claimStatus === "claim_pending") {
      const [existingOpenClaim] = await tx
        .select({ claimantUserId: practiceClaims.claimantUserId })
        .from(practiceClaims)
        .where(
          sql`${practiceClaims.practiceId} = ${input.practiceId} AND ${practiceClaims.status} IN ('submitted', 'under_review', 'query_raised')`,
        )
        .limit(1);

      if (existingOpenClaim?.claimantUserId === input.claimantUserId) {
        throw new Error("You already have an open claim on this practice");
      }

      // A different claimant's claim on an already-pending practice —
      // both claims stand, the record freezes, admin resolves. Never
      // first-come.
      const [claim] = await tx
        .insert(practiceClaims)
        .values({
          practiceId: input.practiceId,
          claimantUserId: input.claimantUserId,
          claimedRelationship: input.claimedRelationship,
          documentUrl: input.documentUrl,
          registrationNumber: input.registrationNumber,
        })
        .returning({ id: practiceClaims.id });

      await tx.update(practices).set({ claimStatus: "disputed" }).where(eq(practices.id, input.practiceId));

      return { id: claim.id, disputed: true };
    }

    // claim_status === 'unclaimed' — the ordinary path.
    const [claim] = await tx
      .insert(practiceClaims)
      .values({
        practiceId: input.practiceId,
        claimantUserId: input.claimantUserId,
        claimedRelationship: input.claimedRelationship,
        documentUrl: input.documentUrl,
        registrationNumber: input.registrationNumber,
      })
      .returning({ id: practiceClaims.id });

    await tx.update(practices).set({ claimStatus: "claim_pending" }).where(eq(practices.id, input.practiceId));

    return { id: claim.id, disputed: false };
  });
}
