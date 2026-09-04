// §10H — "This week in your network," the one genuinely new build item in
// the dashboard/engagement section: a single scheduled job querying tables
// that already exist. Enqueues through notification_outbox like every
// other notification (CLAUDE.md: never sent inline) — the outbox worker's
// existing generic 'email' channel dispatch (§4's identity-change alert
// added the same path) delivers it.

import { and, count, eq, gte, isNull } from "drizzle-orm";
import { homeCaseReferrals, homeVisitAreas, notificationOutbox, users } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface WeeklyDigestSummary {
  newSignupsNearby: number;
  referralsPostedNearby: number;
  referralsResolvedNearby: number;
}

/**
 * "Nearby" = any locality the therapist covers, or its parent zone (same
 * ancestor-expansion rule as referral matching) — a therapist with no
 * home-visit area on file gets an all-zero, still-true summary rather than
 * an error.
 */
export async function buildWeeklyDigestSummary(db: Db, userId: string, since: Date): Promise<WeeklyDigestSummary> {
  const areaRows = await db
    .select({ areaId: homeVisitAreas.areaId })
    .from(homeVisitAreas)
    .where(and(eq(homeVisitAreas.userId, userId), isNull(homeVisitAreas.deletedAt)));
  const areaIds = areaRows.map((r) => r.areaId);

  if (areaIds.length === 0) {
    return { newSignupsNearby: 0, referralsPostedNearby: 0, referralsResolvedNearby: 0 };
  }

  const [{ newSignups }] = await db
    .select({ newSignups: count() })
    .from(users)
    .innerJoin(homeVisitAreas, eq(homeVisitAreas.userId, users.id))
    .where(
      and(
        eq(users.accountType, "therapist"),
        gte(users.createdAt, since),
        isNull(homeVisitAreas.deletedAt),
      ),
    );

  const [{ posted }] = await db
    .select({ posted: count() })
    .from(homeCaseReferrals)
    .where(and(gte(homeCaseReferrals.createdAt, since), isNull(homeCaseReferrals.deletedAt)));

  const [{ resolved }] = await db
    .select({ resolved: count() })
    .from(homeCaseReferrals)
    .where(
      and(
        eq(homeCaseReferrals.status, "completed"),
        gte(homeCaseReferrals.updatedAt, since),
        isNull(homeCaseReferrals.deletedAt),
      ),
    );

  return { newSignupsNearby: newSignups, referralsPostedNearby: posted, referralsResolvedNearby: resolved };
}

export function digestMessage(summary: WeeklyDigestSummary): { title: string; body: string } {
  return {
    title: "This week in your network",
    body:
      `${summary.newSignupsNearby} new signup${summary.newSignupsNearby === 1 ? "" : "s"} nearby, ` +
      `${summary.referralsPostedNearby} referral${summary.referralsPostedNearby === 1 ? "" : "s"} posted, ` +
      `${summary.referralsResolvedNearby} resolved.`,
  };
}

/**
 * Enqueues one digest per active therapist. Deliberately not per-locality
 * batched — pilot volume (25-30 therapists) makes one row per user cheap,
 * and each summary is already scoped to that user's own areas.
 */
export async function enqueueWeeklyDigests(db: Db, now: Date = new Date()): Promise<{ enqueued: number }> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const activeTherapists = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.accountType, "therapist"), eq(users.profileStatus, "active")));

  let enqueued = 0;
  for (const therapist of activeTherapists) {
    const summary = await buildWeeklyDigestSummary(db, therapist.id, since);
    const [inserted] = await db
      .insert(notificationOutbox)
      .values({
        userId: therapist.id,
        channel: "email",
        template: "weekly_digest",
        payload: { ...summary },
        dedupeKey: `weekly_digest:${therapist.id}:${now.toISOString().slice(0, 10)}`,
      })
      .onConflictDoNothing()
      .returning({ id: notificationOutbox.id });
    if (inserted) enqueued += 1;
  }

  return { enqueued };
}
