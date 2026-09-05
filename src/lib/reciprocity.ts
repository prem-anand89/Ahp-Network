// §10H — reciprocity, shown as a private first-person fact, never
// comparative. Both numbers already exist (referral_interest.status='accepted',
// invites.accepted_by_user_id) — this is a display choice, not new
// tracking. Never compared to anyone else, never feeding directory
// ordering or badge state — that line is what keeps this on the private-
// fact side of §1A rather than becoming someone else's judgment of them.

import { and, count, eq, gte } from "drizzle-orm";
import { referralInterest } from "@/db/schema";
import type { getDb } from "@/db/db";
import { countAcceptedInvites } from "./invites";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface ReciprocityStats {
  /** "You've helped connect N patients this month." */
  connectedThisMonth: number;
  /** "N people joined AHP Network through your invite." */
  invitedCount: number;
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getReciprocityStats(db: Db, userId: string, now: Date = new Date()): Promise<ReciprocityStats> {
  const [{ connected }] = await db
    .select({ connected: count() })
    .from(referralInterest)
    .where(
      and(
        eq(referralInterest.therapistUserId, userId),
        eq(referralInterest.status, "accepted"),
        // respondedAt is set by accept_referral() at the moment of acceptance.
        gte(referralInterest.respondedAt, startOfMonth(now)),
      ),
    );

  const invitedCount = await countAcceptedInvites(db, userId);

  return { connectedThisMonth: connected, invitedCount };
}
