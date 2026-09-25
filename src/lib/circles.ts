// §8E2 (Phase 9, first slice) — Circles: private, silent, named lists a
// therapist keeps for themselves. No dependency beyond `users`, which is
// why BUILD_SEQUENCE.md calls this the piece to build first.
//
// Every function here is scoped by ownerUserId at the query level, not just
// checked afterward — a circle row from `db.select().from(circles)` with no
// owner filter is a bug, not a shortcut. This is a private tool; there is
// no admin surface and no cross-owner read path anywhere in this file.
//
// 100% silent, by design (§8E2): nothing here ever writes to
// notification_outbox, and circle_members carries no consent_status. Do
// not add either without re-reading that section first.

import { and, count, eq, isNull, sql } from "drizzle-orm";
import { circleMembers, circles, users } from "@/db/schema";
import type { getDb } from "@/db/db";
import { CIRCLE_COPY } from "@/lib/copy";

type Db = Awaited<ReturnType<typeof getDb>>;

// Step 7D — "The Intimacy Rule": a circle stays small enough to be a real
// trusted list, not a second directory. Enforced here, the single write
// path (see this file's header comment), so the UI cap is a mirror of
// this, never the other way around.
export const CIRCLE_MEMBER_CAP = 15;

export interface CircleWithCount {
  id: string;
  name: string;
  createdAt: Date;
  memberCount: number;
}

export async function listCircles(db: Db, ownerUserId: string): Promise<CircleWithCount[]> {
  return db
    .select({
      id: circles.id,
      name: circles.name,
      createdAt: circles.createdAt,
      memberCount: sql<number>`(SELECT count(*)::int FROM circle_members WHERE circle_id = ${circles.id})`,
    })
    .from(circles)
    .where(and(eq(circles.ownerUserId, ownerUserId), isNull(circles.deletedAt)))
    .orderBy(circles.createdAt);
}

const AVATAR_PILE_SIZE = 4;

export interface CircleMemberPreview {
  userId: string;
  displayName: string | null;
  photoUrl: string | null;
}

/** Step 7D — up to 4 members per circle, for the list view's avatar pile.
 * One query for every circle the owner has, capped and grouped in JS
 * (same over-fetch pattern as directory.ts/onboarding.ts — no per-circle
 * round trip). */
export async function listCircleMemberPreviews(
  db: Db,
  ownerUserId: string,
  circleIds: string[],
): Promise<Map<string, CircleMemberPreview[]>> {
  const result = new Map<string, CircleMemberPreview[]>();
  if (circleIds.length === 0) return result;

  const rows = await db
    .select({
      circleId: circleMembers.circleId,
      userId: users.id,
      displayName: users.displayName,
      photoUrl: users.photoUrl,
    })
    .from(circleMembers)
    .innerJoin(circles, and(eq(circles.id, circleMembers.circleId), eq(circles.ownerUserId, ownerUserId)))
    .innerJoin(users, eq(users.id, circleMembers.therapistUserId))
    .where(sql`${circleMembers.circleId} = ANY(${circleIds})`)
    .orderBy(circleMembers.addedAt);

  for (const row of rows) {
    const existing = result.get(row.circleId) ?? [];
    if (existing.length < AVATAR_PILE_SIZE) existing.push({ userId: row.userId, displayName: row.displayName, photoUrl: row.photoUrl });
    result.set(row.circleId, existing);
  }
  return result;
}

/** Throws if the circle doesn't exist or isn't owned by ownerUserId — the
 * single check every mutation below relies on before touching a row. */
async function requireOwnedCircle(
  db: Db,
  circleId: string,
  ownerUserId: string,
): Promise<{ id: string; name: string }> {
  const [circle] = await db
    .select({ id: circles.id, name: circles.name })
    .from(circles)
    .where(and(eq(circles.id, circleId), eq(circles.ownerUserId, ownerUserId), isNull(circles.deletedAt)));
  if (!circle) throw new Error("Circle not found");
  return circle;
}

export async function getCircle(
  db: Db,
  ownerUserId: string,
  circleId: string,
): Promise<{ id: string; name: string }> {
  return requireOwnedCircle(db, circleId, ownerUserId);
}

export async function createCircle(db: Db, ownerUserId: string, name: string): Promise<{ id: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Circle name is required");
  const [row] = await db.insert(circles).values({ ownerUserId, name: trimmed }).returning({ id: circles.id });
  return row;
}

export async function renameCircle(db: Db, ownerUserId: string, circleId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Circle name is required");
  await requireOwnedCircle(db, circleId, ownerUserId);
  await db.update(circles).set({ name: trimmed }).where(eq(circles.id, circleId));
}

export async function deleteCircle(db: Db, ownerUserId: string, circleId: string): Promise<void> {
  await requireOwnedCircle(db, circleId, ownerUserId);
  await db.update(circles).set({ deletedAt: new Date() }).where(eq(circles.id, circleId));
}

export interface CircleMember {
  userId: string;
  displayName: string | null;
  addedAt: Date;
}

export async function listCircleMembers(db: Db, ownerUserId: string, circleId: string): Promise<CircleMember[]> {
  await requireOwnedCircle(db, circleId, ownerUserId);
  return db
    .select({
      userId: circleMembers.therapistUserId,
      displayName: users.displayName,
      addedAt: circleMembers.addedAt,
    })
    .from(circleMembers)
    .innerJoin(users, eq(users.id, circleMembers.therapistUserId))
    .where(eq(circleMembers.circleId, circleId))
    .orderBy(circleMembers.addedAt);
}

/** Resolves the same public-facing slug a profile URL (/pt/[slug]) uses, so
 * the add-to-circle UI can accept what a therapist would actually type or
 * paste rather than a raw user id. Therapists only — circle_members is a
 * list of professionals to refer to, not an arbitrary user reference. */
export async function findTherapistIdBySlug(db: Db, slug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.slug, slug), eq(users.accountType, "therapist"), isNull(users.deletedAt)));
  return row?.id ?? null;
}

export interface CircleMembershipRow {
  id: string;
  name: string;
  isMember: boolean;
}

/** For the "Add to Circle" entry point on a therapist's public profile
 * (/pt/[slug]): every one of the viewer's own circles, with whether the
 * profile being viewed is already in each. Never exposes anything about
 * who else is in a circle — this is the owner looking at their own list,
 * same privacy scope as listCircles/listCircleMembers above. */
export async function listCirclesWithMembership(
  db: Db,
  ownerUserId: string,
  therapistUserId: string,
): Promise<CircleMembershipRow[]> {
  return db
    .select({
      id: circles.id,
      name: circles.name,
      isMember: sql<boolean>`EXISTS (
        SELECT 1 FROM circle_members
        WHERE circle_id = ${circles.id} AND therapist_user_id = ${therapistUserId}
      )`,
    })
    .from(circles)
    .where(and(eq(circles.ownerUserId, ownerUserId), isNull(circles.deletedAt)))
    .orderBy(circles.createdAt);
}

/** Silent by design: no notification, no counter, no visibility to
 * therapistUserId that they were added — never change that (§8E2). */
export async function addCircleMember(
  db: Db,
  ownerUserId: string,
  circleId: string,
  therapistUserId: string,
): Promise<void> {
  await requireOwnedCircle(db, circleId, ownerUserId);
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, therapistUserId), eq(users.accountType, "therapist"), isNull(users.deletedAt)));
  if (!target) throw new Error("Can only add active therapists to circles");

  const [existing] = await db
    .select({ id: circleMembers.circleId })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.therapistUserId, therapistUserId)));
  if (existing) return;

  const [{ memberCount }] = await db
    .select({ memberCount: count() })
    .from(circleMembers)
    .where(eq(circleMembers.circleId, circleId));
  if (memberCount >= CIRCLE_MEMBER_CAP) throw new Error(CIRCLE_COPY.memberCapError);

  await db.insert(circleMembers).values({ circleId, therapistUserId }).onConflictDoNothing();
}

export async function removeCircleMember(
  db: Db,
  ownerUserId: string,
  circleId: string,
  therapistUserId: string,
): Promise<void> {
  await requireOwnedCircle(db, circleId, ownerUserId);
  await db
    .delete(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.therapistUserId, therapistUserId)));
}
