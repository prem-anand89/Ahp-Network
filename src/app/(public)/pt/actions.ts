"use server";

// §8E2 — server actions for the "Add to Circle" entry point on a public
// therapist profile (/pt/[slug]). Thin wrappers only, matching
// src/app/app/circles/actions.ts: no authz tier beyond "signed in", since
// every mutation in src/lib/circles.ts re-checks circle ownership at the
// query level regardless of what the caller passes.
//
// Never revalidatePath the profile being viewed — the whole point of §8E2
// is that adding someone to a circle leaves no trace on their profile, so
// there is nothing on /pt/[slug] that should ever need to re-render because
// of this.

import { getDb } from "@/db/db";
import { requireAuthUserId } from "@/lib/require-session";
import {
  addCircleMember,
  createCircle,
  listCirclesWithMembership,
  removeCircleMember,
  type CircleMembershipRow,
} from "@/lib/circles";

export async function getCirclesForProfileAction(therapistUserId: string): Promise<CircleMembershipRow[]> {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return listCirclesWithMembership(db, userId, therapistUserId);
}

export async function toggleCircleMembershipAction(
  circleId: string,
  therapistUserId: string,
  shouldBeMember: boolean,
): Promise<void> {
  const userId = await requireAuthUserId();
  const db = await getDb();
  if (shouldBeMember) {
    await addCircleMember(db, userId, circleId, therapistUserId);
  } else {
    await removeCircleMember(db, userId, circleId, therapistUserId);
  }
}

/** Inline "new circle" from the profile picker — creates the circle and
 * adds this therapist to it in one step, since that's the only reason
 * someone opens the picker from a profile in the first place. */
export async function createCircleAndAddAction(
  name: string,
  therapistUserId: string,
): Promise<CircleMembershipRow> {
  const userId = await requireAuthUserId();
  const db = await getDb();
  const circle = await createCircle(db, userId, name);
  await addCircleMember(db, userId, circle.id, therapistUserId);
  return { id: circle.id, name: name.trim(), isMember: true };
}
