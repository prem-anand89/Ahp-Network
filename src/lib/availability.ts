// Profile Card addendum — availability display and the write path for it.
// Nothing here reads or writes `accepting_referrals`, a separate column
// referral matching (§8D) actually reads: availability is a public,
// patient-facing signal, accepting_referrals is a peer-to-peer one, and a
// therapist can reasonably want one on and the other off (full on private
// patients, still open to a colleague's referral). Never conflate them.

import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

// Phase 2 — 21 days, per the plan's explicit staleness spec (was 30,
// pre-dating that decision). Below this, "Available for new patients"
// keeps reading as current even though nobody's confirmed it in three
// weeks.
const STALE_AFTER_DAYS = 21;

export type AvailabilityDisplayState =
  | { kind: "available_fresh"; updatedAt: Date }
  | { kind: "available_stale"; updatedAt: Date }
  | { kind: "limited_fresh"; updatedAt: Date }
  | { kind: "limited_stale"; updatedAt: Date }
  | { kind: "not_accepting"; updatedAt: Date }
  // availability_updated_at is NULL: this therapist has never touched the
  // toggle. capacity_state defaults to not_taking, so treating a
  // NULL timestamp as "not accepting" would publicly label every therapist
  // who never answered as unavailable — they never said either way.
  | { kind: "not_stated" };

export function computeAvailabilityDisplay(
  capacityState: "available" | "limited" | "not_taking",
  availabilityUpdatedAt: Date | null,
): AvailabilityDisplayState {
  if (!availabilityUpdatedAt) return { kind: "not_stated" };
  if (capacityState === "not_taking") return { kind: "not_accepting", updatedAt: availabilityUpdatedAt };

  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const isStale = availabilityUpdatedAt < staleCutoff;

  if (capacityState === "limited") {
    return isStale
      ? { kind: "limited_stale", updatedAt: availabilityUpdatedAt }
      : { kind: "limited_fresh", updatedAt: availabilityUpdatedAt };
  }

  return isStale
    ? { kind: "available_stale", updatedAt: availabilityUpdatedAt }
    : { kind: "available_fresh", updatedAt: availabilityUpdatedAt };
}

/** All columns move together, always — freshness that can drift out of
 * sync with the state it's supposed to describe is worse than no
 * freshness display at all. */
export async function setAvailabilityTx(
  db: Db, 
  userId: string, 
  capacityState: "available" | "limited" | "not_taking",
  capacityNote: string | null = null,
  availableFrom: string | null = null
): Promise<void> {
  await db
    .update(users)
    .set({ 
      capacityState, 
      capacityNote,
      availableFrom: availableFrom || null,
      availabilityUpdatedAt: new Date() 
    })
    .where(eq(users.id, userId));
}
