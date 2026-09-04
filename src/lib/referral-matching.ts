// §8D Step 1 — targeted notification. A posted referral notifies only
// therapists matching ALL of the criteria below. Deliberately a plain SQL
// filter, no scoring engine, no configurable weights — at 25-30 pilot
// therapists that's the entire matching system needed (plan §8D).
//
// `matching_algorithm_version = 'v1'` is frozen on the referral row at
// post time (see referral-actions.ts) specifically so this filter can
// evolve later without corrupting historical matched_pool_size_at_post
// analytics — never change this file's matching semantics without also
// bumping that version string.

import { and, eq, or, isNull, sql } from "drizzle-orm";
import { areas, homeVisitAreas, users } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface MatchCriteria {
  roleNeeded: NonNullable<(typeof users.$inferSelect)["role"]>;
  specializationNeeded: (typeof users.$inferSelect)["specializations"][number];
  areaId: string;
  homeVisitRequired: boolean;
}

export interface MatchedTherapist {
  id: string;
  displayName: string | null;
}

/**
 * The therapists a newly-posted referral notifies. Never used to gate an
 * existing referral's later behaviour (empty-pool zone expansion re-runs
 * this against a wider area set separately) — this is the Step 1 filter
 * only.
 */
export async function matchTherapistsForReferral(
  db: Db,
  criteria: MatchCriteria,
): Promise<MatchedTherapist[]> {
  // The referral's own area's ancestor chain — a therapist who covers a
  // broader zone (e.g. the whole "Gachibowli" zone) still matches a
  // referral posted for a specific locality inside it ("Nanakramguda").
  const [referralArea] = await db
    .select({ ancestorIds: areas.ancestorIds })
    .from(areas)
    .where(eq(areas.id, criteria.areaId));

  const coveringAreaIds = [criteria.areaId, ...(referralArea?.ancestorIds ?? [])];

  const visitTypeColumn = criteria.homeVisitRequired ? users.acceptsHomeVisits : users.acceptsClinicVisits;

  const rows = await db
    .selectDistinct({ id: users.id, displayName: users.displayName })
    .from(users)
    .innerJoin(homeVisitAreas, eq(homeVisitAreas.userId, users.id))
    .where(
      and(
        eq(users.accountType, "therapist"), // CLAUDE.md non-negotiable
        eq(users.role, criteria.roleNeeded),
        // §8D/[v19]: specialization_needed = ANY(users.specializations) —
        // the only matching input. Never therapist_skills.skill_name (free
        // text) or course_completions (a display taxonomy).
        sql`${criteria.specializationNeeded} = ANY(${users.specializations})`,
        eq(users.acceptingReferrals, true),
        eq(visitTypeColumn, true),
        isNull(homeVisitAreas.deletedAt),
        or(...coveringAreaIds.map((id) => eq(homeVisitAreas.areaId, id))),
      ),
    );

  return rows;
}
