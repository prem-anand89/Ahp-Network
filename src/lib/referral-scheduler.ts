// §8D — the deadline scheduler. "A daily cron job cannot service a 2-hour
// urgent window" is a P0 requirement, not an open question: this must run
// on a real sub-hourly cadence (see the cron trigger wiring this calls
// into, .github/workflows/referral-scheduler.yml).
//
// Sweeps lapse_offers() and, execution-plan Phase 4, circle-targeted
// referral widening — both need the same sub-hourly cadence for the same
// reason (a daily job can't service a ~2h urgent window). shortlist-
// window/zone-expansion/admin-alert/auto-close timers ([v20]/§G1) fire as
// admin ops-queue tasks, never as an automated status transition — out of
// this file's scope by design, not an oversight.

import { and, eq, isNull, lte } from "drizzle-orm";
import { homeCaseReferrals, notificationOutbox, referralEvents, referralInterest } from "@/db/schema";
import { matchTherapistsForReferral } from "@/lib/referral-matching";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Finds every 'shortlisted' referral whose offer_expires_at is due and
 * calls lapse_offers() on each — one single-statement call per referral,
 * same discipline as every other call site of the three PL/pgSQL
 * functions (CLAUDE.md non-negotiable: never re-implement the transition
 * client-side). A live accept_referral() racing this sweep is exactly
 * what lapse_offers()'s own row lock and status re-check handle; this
 * function just finds candidates and fires the call, one referral's
 * failure never blocking the rest of the sweep.
 */
export async function sweepLapsedOffers(db: Db): Promise<{ swept: number; results: unknown[] }> {
  const due = await db
    .select({ id: homeCaseReferrals.id })
    .from(homeCaseReferrals)
    .where(and(eq(homeCaseReferrals.status, "shortlisted"), lte(homeCaseReferrals.offerExpiresAt, new Date())));

  const results: unknown[] = [];
  for (const referral of due) {
    const [row] = await db.$client<{ result: unknown }[]>`SELECT lapse_offers(${referral.id}) AS result`;
    results.push(row.result);
  }

  return { swept: due.length, results };
}

/**
 * Execution-plan Phase 4 — opens a circle-targeted referral to the rest of
 * its matched pool once widen_to_pool_at is due. Re-runs
 * matchTherapistsForReferral (never touching matching_algorithm_version)
 * and excludes therapists who already have a referral_interest row for
 * this referral — self-healing (no need to stash the original pool
 * anywhere) and correct even if circle membership changed between post
 * time and now. Skips any referral no longer 'open' (already shortlisted/
 * accepted/closed) rather than erroring — there's nothing left to widen
 * into once the poster has moved on.
 *
 * Marks widened_at unconditionally for every due referral this sweep
 * looks at (even one with zero new therapists to add, or already past
 * 'open') so it's never reconsidered by the next run — the partial index
 * this reads (`home_case_referrals_pending_widen`) excludes it from the
 * next sweep the moment that column is set.
 */
export async function sweepCircleWidening(db: Db): Promise<{ widened: number; therapistsNotified: number }> {
  const due = await db
    .select({
      id: homeCaseReferrals.id,
      status: homeCaseReferrals.status,
      roleNeeded: homeCaseReferrals.roleNeeded,
      specializationNeeded: homeCaseReferrals.specializationNeeded,
      areaId: homeCaseReferrals.areaId,
      homeVisitRequired: homeCaseReferrals.homeVisitRequired,
      postedByUserId: homeCaseReferrals.postedByUserId,
    })
    .from(homeCaseReferrals)
    .where(
      and(
        eq(homeCaseReferrals.targetingMode, "circle"),
        isNull(homeCaseReferrals.widenedAt),
        lte(homeCaseReferrals.widenToPoolAt, new Date()),
      ),
    );

  let therapistsNotified = 0;

  for (const referral of due) {
    if (referral.status === "open" && referral.areaId) {
      const matched = (
        await matchTherapistsForReferral(db, {
          roleNeeded: referral.roleNeeded,
          specializationNeeded: referral.specializationNeeded,
          areaId: referral.areaId,
          homeVisitRequired: referral.homeVisitRequired,
        })
      ).filter((t) => t.id !== referral.postedByUserId);

      const existingInterest = await db
        .select({ therapistUserId: referralInterest.therapistUserId })
        .from(referralInterest)
        .where(eq(referralInterest.referralId, referral.id));
      const alreadyNotified = new Set(existingInterest.map((r) => r.therapistUserId));

      const newlyMatched = matched.filter((t) => !alreadyNotified.has(t.id));

      if (newlyMatched.length > 0) {
        await db
          .insert(referralInterest)
          .values(newlyMatched.map((t) => ({ referralId: referral.id, therapistUserId: t.id })));

        await db.insert(referralEvents).values({
          referralId: referral.id,
          eventType: "widened",
          payload: { therapist_ids: newlyMatched.map((t) => t.id) },
        });

        // A distinct dedupe key from the original `posted:` batch —
        // reusing it would silently suppress this whole notification
        // round under the unique index on dedupe_key. The plain
        // (non-"selected") template: once widened, the first tranche's
        // "sent to a small group" line is suppressed too (checked at
        // read time off widened_at, not stored per-notification).
        await db.insert(notificationOutbox).values(
          newlyMatched.map((t) => ({
            userId: t.id,
            channel: "push" as const,
            template: "referral_posted_match",
            payload: { referral_id: referral.id },
            dedupeKey: `posted:widen:${referral.id}:${t.id}`,
          })),
        );

        therapistsNotified += newlyMatched.length;
      }
    }

    await db.update(homeCaseReferrals).set({ widenedAt: new Date() }).where(eq(homeCaseReferrals.id, referral.id));
  }

  return { widened: due.length, therapistsNotified };
}
