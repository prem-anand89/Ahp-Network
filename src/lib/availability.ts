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

const STALE_AFTER_DAYS = 30;

export type AvailabilityDisplayState =
  | { kind: "available_fresh"; updatedAt: Date }
  | { kind: "available_stale"; updatedAt: Date }
  | { kind: "not_accepting"; updatedAt: Date }
  // availability_updated_at is NULL: this therapist has never touched the
  // toggle. available_for_new_patients defaults to false, so treating a
  // NULL timestamp as "not accepting" would publicly label every therapist
  // who never answered as unavailable — they never said either way.
  | { kind: "not_stated" };

export function computeAvailabilityDisplay(
  availableForNewPatients: boolean,
  availabilityUpdatedAt: Date | null,
): AvailabilityDisplayState {
  if (!availabilityUpdatedAt) return { kind: "not_stated" };
  if (!availableForNewPatients) return { kind: "not_accepting", updatedAt: availabilityUpdatedAt };

  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  return availabilityUpdatedAt < staleCutoff
    ? { kind: "available_stale", updatedAt: availabilityUpdatedAt }
    : { kind: "available_fresh", updatedAt: availabilityUpdatedAt };
}

/** Both columns move together, always — freshness that can drift out of
 * sync with the boolean it's supposed to describe is worse than no
 * freshness display at all. */
export async function setAvailabilityTx(db: Db, userId: string, available: boolean): Promise<void> {
  await db
    .update(users)
    .set({ availableForNewPatients: available, availabilityUpdatedAt: new Date() })
    .where(eq(users.id, userId));
}
