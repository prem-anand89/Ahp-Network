// §8G6 Referral ops admin screen — read-only alerts, referral_ops_admin or
// super_admin. Nothing here writes; a human follows up manually (§G-series
// decision: at most two of §8D's seven timers are ever user-visible, the
// rest — these — fire as admin tasks).

import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { homeCaseReferrals } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

const REROUTE_ESCALATION_THRESHOLD = 2;

export interface ReferralOpsAlertRow {
  id: string;
  status: string;
  urgency: string;
  roleNeeded: string;
  areaId: string | null;
  matchedPoolSizeAtPost: number | null;
  rerouteCount: number;
  createdAt: Date;
}

/** A referral posted with zero (or unrecorded) matches in its area. */
export async function listEmptyPoolReferrals(db: Db): Promise<ReferralOpsAlertRow[]> {
  return db
    .select({
      id: homeCaseReferrals.id,
      status: homeCaseReferrals.status,
      urgency: homeCaseReferrals.urgency,
      roleNeeded: homeCaseReferrals.roleNeeded,
      areaId: homeCaseReferrals.areaId,
      matchedPoolSizeAtPost: homeCaseReferrals.matchedPoolSizeAtPost,
      rerouteCount: homeCaseReferrals.rerouteCount,
      createdAt: homeCaseReferrals.createdAt,
    })
    .from(homeCaseReferrals)
    .where(
      and(
        isNull(homeCaseReferrals.deletedAt),
        sql`${homeCaseReferrals.status} IN ('open','shortlisted')`,
        lte(homeCaseReferrals.matchedPoolSizeAtPost, 0),
      ),
    )
    .orderBy(homeCaseReferrals.createdAt);
}

/** Urgent referrals still open/unfilled — the highest-priority human
 * follow-up in this screen. */
export async function listUnservedUrgentReferrals(db: Db): Promise<ReferralOpsAlertRow[]> {
  return db
    .select({
      id: homeCaseReferrals.id,
      status: homeCaseReferrals.status,
      urgency: homeCaseReferrals.urgency,
      roleNeeded: homeCaseReferrals.roleNeeded,
      areaId: homeCaseReferrals.areaId,
      matchedPoolSizeAtPost: homeCaseReferrals.matchedPoolSizeAtPost,
      rerouteCount: homeCaseReferrals.rerouteCount,
      createdAt: homeCaseReferrals.createdAt,
    })
    .from(homeCaseReferrals)
    .where(
      and(
        isNull(homeCaseReferrals.deletedAt),
        eq(homeCaseReferrals.urgency, "urgent"),
        sql`${homeCaseReferrals.status} IN ('open','shortlisted')`,
      ),
    )
    .orderBy(homeCaseReferrals.createdAt);
}

/** Referrals that have already been rerouted twice and are still open —
 * §8D's 2-reroute escalation, surfaced for a human to intervene manually. */
export async function listRerouteEscalations(db: Db): Promise<ReferralOpsAlertRow[]> {
  return db
    .select({
      id: homeCaseReferrals.id,
      status: homeCaseReferrals.status,
      urgency: homeCaseReferrals.urgency,
      roleNeeded: homeCaseReferrals.roleNeeded,
      areaId: homeCaseReferrals.areaId,
      matchedPoolSizeAtPost: homeCaseReferrals.matchedPoolSizeAtPost,
      rerouteCount: homeCaseReferrals.rerouteCount,
      createdAt: homeCaseReferrals.createdAt,
    })
    .from(homeCaseReferrals)
    .where(
      and(
        isNull(homeCaseReferrals.deletedAt),
        sql`${homeCaseReferrals.status} IN ('open','shortlisted')`,
        sql`${homeCaseReferrals.rerouteCount} >= ${REROUTE_ESCALATION_THRESHOLD}`,
      ),
    )
    .orderBy(homeCaseReferrals.createdAt);
}
