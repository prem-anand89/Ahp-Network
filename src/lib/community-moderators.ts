// §8E3 — moderation for institution/certification communities only.
// Workplace and platform-curated communities already have an accountable
// owner (the practice, or the creating admin), so they never need this.
//
// Self-nomination + admin approval — the same shape practice_claims
// already uses, not a new pattern. Multiple moderators per community, not
// an exclusive seat. Revocable by super_admin, never re-votable: a
// revoked row falls outside community_moderators_one_active's partial
// index, so the same person applying again gets a fresh 'pending' row
// rather than resurrecting the revoked one.
//
// Deliberately kept entirely outside admin_user_roles (§8G5) — a
// moderator can approve or reject posts in their one community only, no
// platform verification-queue visibility, no admin-mode access, no
// proximity to patient contact data.

import { and, eq, inArray } from "drizzle-orm";
import { communityModerators, communities, users } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export async function isApprovedModerator(db: Db, communityId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: communityModerators.id })
    .from(communityModerators)
    .where(
      and(
        eq(communityModerators.communityId, communityId),
        eq(communityModerators.userId, userId),
        eq(communityModerators.status, "approved"),
      ),
    );
  return Boolean(row);
}

/**
 * Any verified member can apply. Authorization (verification stage,
 * community-eligibility per §8E3) is the caller's job; this only inserts
 * the row, and is a no-op if the user already has a pending or approved
 * application for this community (the partial unique index enforces
 * that, this just avoids surfacing the resulting DB error to the caller).
 */
export async function applyForModeratorTx(db: Db, communityId: string, userId: string): Promise<void> {
  const [existing] = await db
    .select({ id: communityModerators.id })
    .from(communityModerators)
    .where(
      and(
        eq(communityModerators.communityId, communityId),
        eq(communityModerators.userId, userId),
        inArray(communityModerators.status, ["pending", "approved"]),
      ),
    );
  if (existing) return;

  await db.insert(communityModerators).values({ communityId, userId });
}

export async function approveModeratorTx(db: Db, moderatorRowId: string, adminUserId: string): Promise<void> {
  await db
    .update(communityModerators)
    .set({ status: "approved", reviewedByAdminId: adminUserId, reviewedAt: new Date() })
    .where(and(eq(communityModerators.id, moderatorRowId), eq(communityModerators.status, "pending")));
}

export async function rejectModeratorApplicationTx(
  db: Db,
  moderatorRowId: string,
  adminUserId: string,
): Promise<void> {
  await db
    .update(communityModerators)
    .set({ status: "revoked", reviewedByAdminId: adminUserId, reviewedAt: new Date(), revokedAt: new Date(), revokedByAdminId: adminUserId })
    .where(and(eq(communityModerators.id, moderatorRowId), eq(communityModerators.status, "pending")));
}

/** super_admin only (authz's job to enforce) — never re-votable, this is terminal. */
export async function revokeModeratorTx(db: Db, moderatorRowId: string, adminUserId: string): Promise<void> {
  await db
    .update(communityModerators)
    .set({ status: "revoked", revokedAt: new Date(), revokedByAdminId: adminUserId })
    .where(and(eq(communityModerators.id, moderatorRowId), eq(communityModerators.status, "approved")));
}

export interface ModeratorApplication {
  id: string;
  communityId: string;
  communityName: string;
  userId: string;
  applicantName: string | null;
  applicantEmail: string;
  appliedAt: Date;
}

export async function listPendingModeratorApplications(db: Db): Promise<ModeratorApplication[]> {
  return db
    .select({
      id: communityModerators.id,
      communityId: communityModerators.communityId,
      communityName: communities.name,
      userId: communityModerators.userId,
      applicantName: users.legalName,
      applicantEmail: users.email,
      appliedAt: communityModerators.appliedAt,
    })
    .from(communityModerators)
    .innerJoin(communities, eq(communities.id, communityModerators.communityId))
    .innerJoin(users, eq(users.id, communityModerators.userId))
    .where(eq(communityModerators.status, "pending"))
    .orderBy(communityModerators.appliedAt);
}

export interface ApprovedModerator {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  approvedAt: Date | null;
}

export async function listApprovedModerators(db: Db, communityId: string): Promise<ApprovedModerator[]> {
  const rows = await db
    .select({
      id: communityModerators.id,
      userId: communityModerators.userId,
      name: users.legalName,
      email: users.email,
      approvedAt: communityModerators.reviewedAt,
    })
    .from(communityModerators)
    .innerJoin(users, eq(users.id, communityModerators.userId))
    .where(and(eq(communityModerators.communityId, communityId), eq(communityModerators.status, "approved")));
  return rows;
}
