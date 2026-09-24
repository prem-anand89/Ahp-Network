// §8D Step 1 — targeted notification. A posted referral notifies only
// therapists matching ALL of the criteria below. Deliberately a plain SQL
// filter, no scoring engine, no configurable weights — at 25-30 pilot
// therapists that's the entire matching system needed (plan §8D).
//
// `matching_algorithm_version` is frozen on the referral row at post time
// (see referral-actions.ts) specifically so this filter can evolve later
// without corrupting historical matched_pool_size_at_post analytics —
// never change this file's matching semantics without also bumping that
// version string.

import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { areas, homeVisitAreas, practiceUsers, practices, users } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;
type Condition = SQL;

// Round 3 step D — bumped from 'v1'. Frozen onto each referral row at
// post time (referral-actions.ts); never change this file's matching
// semantics without bumping it, per the file header above.
export const MATCHING_ALGORITHM_VERSION = "v2";

export interface MatchCriteria {
  roleNeeded: NonNullable<(typeof users.$inferSelect)["role"]>;
  specializationNeeded: (typeof users.$inferSelect)["specializations"][number];
  /** null means "city-wide, no locality to match against" — refused at
   * the schema level for a home visit (home_case_referrals_area_scope_
   * home_visit); only a clinic visit can be area-agnostic, since a
   * therapist travelling to the patient is inherently locality-bound. */
  areaId: string | null;
  /** Round 3 step D — the patient's city. Required (and only read) when
   * areaId is null: a city-wide clinic match needs to know which city.
   * A locality-scope match (either visit type) derives the city itself
   * from areaId's own row, so callers never need to pass it there. */
  cityAreaId?: string | null;
  homeVisitRequired: boolean;
}

export interface MatchedTherapist {
  id: string;
  displayName: string | null;
}

function dedupeById(rows: MatchedTherapist[]): MatchedTherapist[] {
  const seen = new Map<string, MatchedTherapist>();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}

/**
 * Home visit — unchanged from v1: a therapist matches when one of their
 * (either-tier — tier is display-only, Round 3 step C) home_visit_areas
 * rows is the referral's exact locality or a broader zone/city they
 * ticked (the locality's own ancestor_ids). Step 5 decision 11's
 * curation_status/is_active gate stays on the THERAPIST'S covered area
 * (a real curation safeguard against an unreviewed proposal) — it was
 * never what let a referral posted to a brand-new pending locality still
 * match; that already works unconditionally via ancestor_ids below.
 */
async function matchByHomeVisitCoverage(
  db: Db,
  referralAreaId: string,
  baseConditions: Condition[],
): Promise<MatchedTherapist[]> {
  const [referralArea] = await db
    .select({ ancestorIds: areas.ancestorIds })
    .from(areas)
    .where(eq(areas.id, referralAreaId));

  const coveringAreaIds = [referralAreaId, ...(referralArea?.ancestorIds ?? [])];

  return db
    .selectDistinct({ id: users.id, displayName: users.displayName })
    .from(users)
    .innerJoin(homeVisitAreas, eq(homeVisitAreas.userId, users.id))
    .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
    .where(
      and(
        ...baseConditions,
        isNull(homeVisitAreas.deletedAt),
        eq(areas.curationStatus, "approved"),
        eq(areas.isActive, true),
        inArray(homeVisitAreas.areaId, coveringAreaIds),
      ),
    );
}

/**
 * Clinic visit — Round 3 step D decision D2: the patient travels to the
 * therapist, so matching reads the therapist's base locality
 * (home_visit_areas.is_primary) or an active practice's locality, never
 * home-visit coverage (which records where a therapist travels TO, the
 * wrong direction for a clinic visit). `zoneCondition` decides "same
 * zone" for a locality-scope referral, or "same city" for a city-wide
 * one; the two clinic callers below only differ in which they pass.
 */
async function matchClinic(
  db: Db,
  baseConditions: Condition[],
  zoneCondition: (areaTable: typeof areas) => Condition,
): Promise<MatchedTherapist[]> {
  const [viaBase, viaPractice] = await Promise.all([
    db
      .selectDistinct({ id: users.id, displayName: users.displayName })
      .from(users)
      .innerJoin(
        homeVisitAreas,
        and(eq(homeVisitAreas.userId, users.id), eq(homeVisitAreas.isPrimary, true), isNull(homeVisitAreas.deletedAt)),
      )
      .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
      .where(and(...baseConditions, eq(areas.curationStatus, "approved"), eq(areas.isActive, true), zoneCondition(areas))),
    db
      .selectDistinct({ id: users.id, displayName: users.displayName })
      .from(users)
      .innerJoin(
        practiceUsers,
        and(
          eq(practiceUsers.userId, users.id),
          eq(practiceUsers.status, "active"),
          isNull(practiceUsers.deletedAt),
          isNull(practiceUsers.endedAt),
        ),
      )
      .innerJoin(practices, and(eq(practices.id, practiceUsers.practiceId), isNull(practices.deletedAt)))
      .innerJoin(areas, eq(areas.id, practices.areaId))
      .where(and(...baseConditions, eq(areas.curationStatus, "approved"), eq(areas.isActive, true), zoneCondition(areas))),
  ]);

  return dedupeById([...viaBase, ...viaPractice]);
}

async function matchClinicByCity(db: Db, cityAreaId: string, baseConditions: Condition[]): Promise<MatchedTherapist[]> {
  return matchClinic(db, baseConditions, (areaTable) => eq(areaTable.cityAreaId, cityAreaId));
}

async function matchClinicByZoneOrCity(
  db: Db,
  referralAreaId: string,
  baseConditions: Condition[],
): Promise<MatchedTherapist[]> {
  const [referralArea] = await db
    .select({ parentId: areas.parentId, cityAreaId: areas.cityAreaId })
    .from(areas)
    .where(eq(areas.id, referralAreaId));
  if (!referralArea?.cityAreaId) return [];

  const [parent] = referralArea.parentId
    ? await db.select({ areaLevel: areas.areaLevel }).from(areas).where(eq(areas.id, referralArea.parentId))
    : [];
  // The zone (taluk) directly above the referral's locality, or null when
  // that locality is filed straight under its city (no zone chosen) —
  // falls back to same-city below, the only unit left to match on.
  const zoneId = parent?.areaLevel === "zone" ? referralArea.parentId : null;

  return matchClinic(db, baseConditions, (areaTable) =>
    zoneId
      ? or(sql`${zoneId} = ANY(${areaTable.ancestorIds})`, eq(areaTable.id, zoneId))!
      : eq(areaTable.cityAreaId, referralArea.cityAreaId!),
  );
}

/**
 * Round 3 step D — resolves and validates a referral's `city_area_id`
 * server-side, never taken from the client as-is (review findings 4 and
 * 6). A locality must genuinely be a locality row, not a zone or city id
 * someone passed by mistake — matching a referral at a zone silently
 * excludes anyone whose coverage is a locality inside it. Shared between
 * `postReferralTx` (referral-actions.ts) and the pool-preview action
 * below, so the two can never disagree about which city a draft referral
 * resolves to.
 */
export async function resolveReferralCityAreaId(
  db: Db,
  input: { areaScope: "locality" | "city"; areaId?: string | null; cityAreaId?: string | null },
): Promise<string> {
  if (input.areaScope === "locality") {
    if (!input.areaId) throw new Error("Choose the locality this referral is for");
    const [area] = await db
      .select({ areaLevel: areas.areaLevel, cityAreaId: areas.cityAreaId })
      .from(areas)
      .where(eq(areas.id, input.areaId));
    if (!area || area.areaLevel !== "locality" || !area.cityAreaId) {
      throw new Error("Choose a specific locality, not a zone or city");
    }
    return area.cityAreaId;
  }
  if (!input.cityAreaId) throw new Error("Choose the patient's city");
  const [city] = await db.select({ areaLevel: areas.areaLevel }).from(areas).where(eq(areas.id, input.cityAreaId));
  if (!city || city.areaLevel !== "city") {
    throw new Error("Choose a valid city");
  }
  return input.cityAreaId;
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
  const visitTypeColumn = criteria.homeVisitRequired ? users.acceptsHomeVisits : users.acceptsClinicVisits;

  const baseConditions = [
    eq(users.accountType, "therapist"), // CLAUDE.md non-negotiable
    eq(users.role, criteria.roleNeeded),
    // §8D/[v19]: specialization_needed = ANY(users.specializations) —
    // the only matching input. Never therapist_skills.skill_name (free
    // text) or course_completions (a display taxonomy).
    sql`${criteria.specializationNeeded} = ANY(${users.specializations})`,
    eq(users.acceptingReferrals, true),
    eq(visitTypeColumn, true),
    // Round 3 step D (review finding — v1 never checked either of these):
    // a draft/waitlisted/suspended or soft-deleted therapist, or one who
    // hasn't reached either verified tier, can't actually accept a
    // referral (src/lib/authz.ts's claim_referral) — matching them wastes
    // a push and would inflate the pool-preview count with people who'd
    // have to be turned away. Round 3 decision 1: either verified tier.
    eq(users.profileStatus, "active"),
    isNull(users.deletedAt),
    inArray(users.verificationStage, ["qualification_confirmed", "credentials_verified"]),
  ] as Condition[];

  if (criteria.homeVisitRequired) {
    // A home visit is always locality-scope (home_case_referrals_area_
    // scope_home_visit's CHECK) — defensive only, never actually null.
    if (!criteria.areaId) return [];
    return matchByHomeVisitCoverage(db, criteria.areaId, baseConditions);
  }

  if (criteria.areaId === null) {
    // Defensive — postReferralTx always derives and stores cityAreaId
    // for a city-scope post; a caller that somehow omits it gets no
    // matches rather than the pre-Round-3 bug of matching every
    // therapist in the country.
    if (!criteria.cityAreaId) return [];
    return matchClinicByCity(db, criteria.cityAreaId, baseConditions);
  }

  return matchClinicByZoneOrCity(db, criteria.areaId, baseConditions);
}

/**
 * Round 3 step D — "N therapists match" before posting, and whether a
 * chosen First Look target is among them. Calls matchTherapistsForReferral
 * itself rather than a second, separately-written query, so the preview
 * and the real post can never drift apart (plan: "never a second query
 * written separately, so it can't drift").
 */
export async function countMatchesForReferral(
  db: Db,
  criteria: MatchCriteria,
  excludingUserId: string,
  targetTherapistId?: string,
): Promise<{ count: number; targetMatches: boolean | null }> {
  const matched = (await matchTherapistsForReferral(db, criteria)).filter((t) => t.id !== excludingUserId);
  return {
    count: matched.length,
    targetMatches: targetTherapistId ? matched.some((t) => t.id === targetTherapistId) : null,
  };
}
