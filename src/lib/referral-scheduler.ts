// §8D — the deadline scheduler. "A daily cron job cannot service a 2-hour
// urgent window" is a P0 requirement, not an open question: this must run
// on a real sub-hourly cadence (see the cron trigger wiring this calls
// into, .github/workflows/referral-scheduler.yml).
//
// Only lapse_offers() is swept here. shortlist-window/zone-expansion/
// admin-alert/auto-close timers ([v20]/§G1) fire as admin ops-queue tasks,
// never as an automated status transition — out of this file's scope by
// design, not an oversight.

import { and, eq, lte } from "drizzle-orm";
import { homeCaseReferrals } from "@/db/schema";
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
