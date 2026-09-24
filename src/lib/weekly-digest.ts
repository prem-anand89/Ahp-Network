// §10H — "This week in your network," the one genuinely new build item in
// the dashboard/engagement section: a single scheduled job querying tables
// that already exist. Enqueues through notification_outbox like every
// other notification (CLAUDE.md: never sent inline) — the outbox worker's
// existing generic 'email' channel dispatch (§4's identity-change alert
// added the same path) delivers it.

import { and, eq, isNull } from "drizzle-orm";
import { homeVisitAreas, notificationOutbox, users } from "@/db/schema";
import type { getDb } from "@/db/db";
import { computeAvailabilityDisplay } from "./availability";
import { SITE_METADATA } from "./site-metadata";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface WeeklyDigestSummary {
  newSignupsNearby: number;
  referralsPostedNearby: number;
  referralsResolvedNearby: number;
  /** Phase 2 — "the weekly digest asks one question with two buttons"
   * (the plan's framing; this channel is plain-text email, so it's one
   * question with one link to the toggle). True only when the therapist
   * was actually available and just hasn't confirmed it in 21+ days —
   * never fires for someone who explicitly said not_accepting or never
   * touched the toggle at all, since neither of those is a stale "yes." */
  availabilityStale: boolean;
}

/**
 * "Nearby" = any locality the therapist covers, or its parent zone (same
 * ancestor-expansion rule as referral matching, referral-matching.ts) — a
 * therapist with no home-visit area on file gets an all-zero, still-true
 * summary rather than an error.
 *
 * Uses the raw postgres.js client (db.$client), not drizzle's own `sql`
 * tag, for the same reason referral-actions.ts does: drizzle's tag renders
 * a raw JS array parameter as a parenthesized tuple instead of binding it
 * as a single array, which both `= ANY(...)` and the `&&` overlap check
 * below need bound correctly.
 */
export async function buildWeeklyDigestSummary(db: Db, userId: string, since: Date): Promise<WeeklyDigestSummary> {
  const [me] = await db
    .select({ capacityState: users.capacityState, availabilityUpdatedAt: users.availabilityUpdatedAt })
    .from(users)
    .where(eq(users.id, userId));
  const availabilityStale = me
    ? computeAvailabilityDisplay(me.capacityState, me.availabilityUpdatedAt).kind === "available_stale"
    : false;

  const areaRows = await db
    .select({ areaId: homeVisitAreas.areaId })
    .from(homeVisitAreas)
    .where(and(eq(homeVisitAreas.userId, userId), isNull(homeVisitAreas.deletedAt)));
  const areaIds = areaRows.map((r) => r.areaId);

  // areaIds may legitimately be empty here (no home-visit area on file) —
  // that still zeroes out newSignupsNearby (an area-only concept below),
  // but referralsPostedNearby/referralsResolvedNearby must not early-
  // return 0 regardless: a city-wide referral (review item #1) is
  // "nearby" to every therapist by definition, area coverage or not, so
  // those two counts stay live even for someone with zero home-visit
  // areas. `= ANY('{}')` against an empty array below is simply always
  // false, which is the correct area-side answer in that case.
  const newSignups =
    areaIds.length === 0
      ? 0
      : (
          // A therapist covering area X is notified of a referral posted
          // at area Y when X = Y or X is one of Y's ancestors
          // (matchTherapistsForReferral's own coveringAreaIds rule,
          // applied here from the therapist's side) — equivalently, Y's
          // area is "nearby" when Y = ANY(X's areas) or Y's own
          // ancestor_ids overlaps X's areas.
          await db.$client<{ new_signups: number }[]>`
    SELECT count(DISTINCT u.id)::int AS new_signups
    FROM users u
    INNER JOIN home_visit_areas hva ON hva.user_id = u.id
    WHERE u.account_type = 'therapist'
      AND u.created_at >= ${since.toISOString()}
      AND hva.deleted_at IS NULL
      AND hva.area_id = ANY(${areaIds})`
        )[0].new_signups;

  // LEFT JOIN, not JOIN: a city-wide referral (review item #1) has
  // area_id IS NULL and would never match an INNER JOIN to areas at all,
  // silently vanishing from every therapist's digest regardless of role
  // or specialization fit. area_scope = 'city' counts unconditionally —
  // same reasoning as matchTherapistsForReferral skipping the area
  // filter entirely for it — everyone "nearby" enough to see a locality-
  // scoped post is also nearby enough to see one with no locality at all.
  const [{ posted }] = await db.$client<{ posted: number }[]>`
    SELECT count(*)::int AS posted
    FROM home_case_referrals r
    LEFT JOIN areas a ON a.id = r.area_id
    WHERE r.created_at >= ${since.toISOString()}
      AND r.deleted_at IS NULL
      AND (r.area_scope = 'city' OR r.area_id = ANY(${areaIds}) OR a.ancestor_ids && ${areaIds})`;

  const [{ resolved }] = await db.$client<{ resolved: number }[]>`
    SELECT count(*)::int AS resolved
    FROM home_case_referrals r
    LEFT JOIN areas a ON a.id = r.area_id
    WHERE r.status = 'completed'
      AND r.updated_at >= ${since.toISOString()}
      AND r.deleted_at IS NULL
      AND (r.area_scope = 'city' OR r.area_id = ANY(${areaIds}) OR a.ancestor_ids && ${areaIds})`;

  return {
    newSignupsNearby: Number(newSignups),
    referralsPostedNearby: Number(posted),
    referralsResolvedNearby: Number(resolved),
    availabilityStale,
  };
}

export function digestMessage(summary: WeeklyDigestSummary): { title: string; body: string } {
  const activity =
    `${summary.newSignupsNearby} new signup${summary.newSignupsNearby === 1 ? "" : "s"} nearby, ` +
    `${summary.referralsPostedNearby} referral${summary.referralsPostedNearby === 1 ? "" : "s"} posted, ` +
    `${summary.referralsResolvedNearby} resolved.`;

  // Phase 2 — "a green dot untouched for four months is a lie." One
  // question, asked here instead of left to go stale silently: still
  // available? Confirm it (or turn it off) from the dashboard.
  const nudge = summary.availabilityStale
    ? ` Still available for new patients? Confirm it (or update it) here: ${SITE_METADATA.url}/app/dashboard`
    : "";

  return {
    title: "This week in your network",
    body: activity + nudge,
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
