// §8D — the deadline scheduler. "A daily cron job cannot service a 2-hour
// urgent window" is a P0 requirement, not an open question: this must run
// on a real sub-hourly cadence (see the cron trigger wiring this calls
// into, .github/workflows/referral-scheduler.yml).
//
// lapse_offers() and Phase 5's circle-first window are swept here.
// shortlist-window/zone-expansion/admin-alert/auto-close timers
// ([v20]/§G1) fire as admin ops-queue tasks, never as an automated status
// transition — out of this file's scope by design, not an oversight.
// Circle-first opening is different in kind from those: the poster chose
// an explicit window at post time ("ask my circle first for 4 hours"),
// so honoring it is a core mechanic of the referral itself, the same
// category as an offer lapsing — not a founder follow-up nudge.

import { and, eq, isNull, lte, sql } from "drizzle-orm";
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
 * Phase 5, generalized in Round 2 — extends a First Look referral's
 * matched pool to everyone once circle_first_window has passed since
 * posting. Applies identically whatever the target kind (circle,
 * community, or one named therapist) — this function never reads which
 * one it was, only that a window exists and hasn't opened yet. Re-runs
 * the same matching filter used at post time (matchTherapistsForReferral)
 * rather than reusing any cached list — matching always reads live
 * profile state everywhere else in this codebase (empty-pool zone
 * expansion does the same), and a therapist's eligibility can genuinely
 * change in a few hours (a credential could get approved, availability
 * could change). Only inserts referral_interest for whoever doesn't
 * already have one (the target's own members, who got in at post time,
 * keep their existing row untouched) — never a second notification to
 * someone already notified. Skips expansion entirely when the poster
 * chose expand_to_network = false (infrastructure only — no UI sets this
 * yet) but still marks the window opened, so expressInterestTx's gate
 * lifts either way.
 */
export async function openCircleFirstReferrals(db: Db): Promise<{ opened: number }> {
  const due = await db
    .select({
      id: homeCaseReferrals.id,
      postedByUserId: homeCaseReferrals.postedByUserId,
      roleNeeded: homeCaseReferrals.roleNeeded,
      specializationNeeded: homeCaseReferrals.specializationNeeded,
      areaId: homeCaseReferrals.areaId,
      homeVisitRequired: homeCaseReferrals.homeVisitRequired,
      expandToNetwork: homeCaseReferrals.expandToNetwork,
    })
    .from(homeCaseReferrals)
    .where(
      and(
        eq(homeCaseReferrals.status, "open"),
        isNull(homeCaseReferrals.circleFirstOpenedAt),
        isNull(homeCaseReferrals.deletedAt),
        sql`${homeCaseReferrals.circleFirstWindow} IS NOT NULL`,
        sql`${homeCaseReferrals.createdAt} + ${homeCaseReferrals.circleFirstWindow} <= now()`,
      ),
    );

  let opened = 0;
  for (const referral of due) {
    if (!referral.areaId) continue; // areaId is nullable on the column; every real post sets it, but stay defensive

    if (referral.expandToNetwork) {
      const alreadyNotified = await db
        .select({ therapistUserId: referralInterest.therapistUserId })
        .from(referralInterest)
        .where(eq(referralInterest.referralId, referral.id));
      const alreadyNotifiedIds = new Set(alreadyNotified.map((r) => r.therapistUserId));

      const matched = (
        await matchTherapistsForReferral(db, {
          roleNeeded: referral.roleNeeded,
          specializationNeeded: referral.specializationNeeded,
          areaId: referral.areaId,
          homeVisitRequired: referral.homeVisitRequired,
        })
      ).filter((t) => t.id !== referral.postedByUserId && !alreadyNotifiedIds.has(t.id));

      if (matched.length > 0) {
        await db
          .insert(referralInterest)
          .values(matched.map((t) => ({ referralId: referral.id, therapistUserId: t.id })))
          .onConflictDoNothing();

        await db.insert(referralEvents).values({
          referralId: referral.id,
          eventType: "notification_dispatched",
          payload: { therapist_ids: matched.map((t) => t.id), circle_first_window_opened: true },
        });

        await db.insert(notificationOutbox).values(
          matched.map((t) => ({
            userId: t.id,
            channel: "push" as const,
            template: "referral_posted_match",
            payload: { referral_id: referral.id },
            dedupeKey: `posted:${referral.id}:${t.id}`,
          })),
        );
      }
    }

    await db
      .update(homeCaseReferrals)
      .set({ circleFirstOpenedAt: new Date() })
      .where(eq(homeCaseReferrals.id, referral.id));
    opened++;
  }

  return { opened };
}
