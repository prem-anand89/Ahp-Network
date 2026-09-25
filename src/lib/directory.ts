// §9 — the public directory's filter taxonomy and sort order. Filters
// narrow the result set; they NEVER change the order (plan §9: no filter,
// now or later, ever introduces a user-selectable sort — this fixed order
// is unconditional regardless of which filters are active):
//   1. Credentials Verified > Qualification Confirmed > Unverified
//   2. Availability recency (capacity_state, then
//      availability_updated_at descending)
//   3. Profile completeness (internal ordering input only, never shown —
//      see profile-completeness.ts)
//   4. Randomised tiebreak
//
// [E4] verifiedOnly defaults OFF everywhere — hiding qualification_confirmed
// profiles would hide the exact audience §8A1a invented that tier for.

import { and, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { getDb } from "@/db/db";
import {
  users,
  homeVisitAreas,
  areas,
  credentials,
  courseCompletions,
  type roleNeededTypeEnum,
  type SpecializationType,
  type genderTypeEnum,
  type ageGroupTypeEnum,
} from "@/db/schema";
import { profileCompletenessScore } from "./profile-completeness";

type RoleNeededType = (typeof roleNeededTypeEnum.enumValues)[number];
type GenderType = (typeof genderTypeEnum.enumValues)[number];
type AgeGroupType = (typeof ageGroupTypeEnum.enumValues)[number];

export type ExperienceBucket = "0-2" | "3-5" | "6-10" | "10+";

export interface DirectoryFilters {
  // Default filters (§9)
  role?: RoleNeededType;
  /** Round 3 step F — a real areas FK (national registry), city/zone/
   * locality all valid: matched via ancestor_ids containment below, not
   * an exact id, so a therapist who covers a whole zone/city as primary
   * shows up for every locality filter within it. */
  areaId?: string;
  /** Round 3 step F — narrows to one city, independent of areaId (the
   * directory's bounded "cities with a listed therapist" filter, plan
   * §6 — never the whole national registry). */
  cityAreaId?: string;
  visitType?: "home" | "clinic";
  specialization?: SpecializationType;
  // Progressive-disclosure filters (§9)
  language?: string;
  institutionId?: string;
  courseId?: string;
  gender?: GenderType;
  ageGroup?: AgeGroupType;
  experienceBucket?: ExperienceBucket;
  teleRehab?: boolean;
  verifiedOnly?: boolean; // [E4] defaults false — the caller must opt in explicitly
}

export interface DirectoryProfile {
  id: string;
  slug: string | null;
  displayName: string | null;
  photoUrl: string | null;
  role: RoleNeededType | null;
  specializations: SpecializationType[];
  verificationStage: "unverified" | "qualification_confirmed" | "credentials_verified";
  capacityState: "available" | "limited" | "not_taking";
  /** Already fetched for sort ordering below — now also carried through
   * to the card, which needs it for the staleness check (a jade dot
   * nobody's confirmed in 30+ days is a lie by omission). */
  availabilityUpdatedAt: Date | null;
  /** Phase 3 fix: this was never queried at all, so every ProfileCard
   * on this page passed no verifiedSinceLabel — the badge tooltip read
   * "Credentials Verified — . An AHP Network admin..." for every result. */
  verifiedSince: Date | null;
  teleRehabAvailable: boolean;
  /** One of the therapist's own home-visit areas (not the filter's), for card display. */
  localityLabel: string | null;
}

const CAPACITY_RANK = { available: 0, limited: 1, not_taking: 2 };

const TIER_RANK: Record<DirectoryProfile["verificationStage"], number> = {
  credentials_verified: 0,
  qualification_confirmed: 1,
  unverified: 2,
};

function experienceBucketRange(bucket: ExperienceBucket): [number, number] {
  switch (bucket) {
    case "0-2":
      return [0, 2];
    case "3-5":
      return [3, 5];
    case "6-10":
      return [6, 10];
    case "10+":
      return [10, Number.MAX_SAFE_INTEGER];
  }
}

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * `db` is injected (not fetched internally via getDb()) so this is
 * directly testable against a real Postgres client in a plain Vitest
 * environment — the same pattern as submitPracticeClaimTx and
 * matchOrQueueInstitution. Callers in Next.js route code pass
 * `await getDb()`.
 */
export async function searchDirectory(
  db: Db,
  filters: DirectoryFilters,
): Promise<DirectoryProfile[]> {
  const conditions = [
    eq(users.accountType, "therapist"),
    eq(users.profileStatus, "active"),
    eq(users.profileVisibility, "public"),
    isNull(users.deletedAt),
  ];

  if (filters.role) conditions.push(eq(users.role, filters.role));
  if (filters.visitType === "home") conditions.push(eq(users.acceptsHomeVisits, true));
  if (filters.visitType === "clinic") conditions.push(eq(users.acceptsClinicVisits, true));
  if (filters.specialization) {
    conditions.push(sql`${filters.specialization} = ANY(${users.specializations})`);
  }
  if (filters.gender) conditions.push(eq(users.gender, filters.gender));
  if (filters.ageGroup) {
    conditions.push(sql`${filters.ageGroup} = ANY(${users.ageGroupsServed})`);
  }
  if (filters.teleRehab) conditions.push(eq(users.teleRehabAvailable, true));
  if (filters.language) {
    conditions.push(sql`${filters.language} = ANY(${users.languages})`);
  }
  // [E4] Defaults OFF — only applied when the caller explicitly opts in.
  if (filters.verifiedOnly) {
    conditions.push(eq(users.verificationStage, "credentials_verified"));
  }
  if (filters.experienceBucket) {
    const [min, max] = experienceBucketRange(filters.experienceBucket);
    conditions.push(
      max === Number.MAX_SAFE_INTEGER
        ? sql`${users.yearsExperience} >= ${min}`
        : sql`${users.yearsExperience} BETWEEN ${min} AND ${max}`,
    );
  }

  if (filters.cityAreaId) {
    const matchingUserIds = db
      .select({ userId: homeVisitAreas.userId })
      .from(homeVisitAreas)
      .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
      .where(
        and(
          eq(areas.cityAreaId, filters.cityAreaId),
          isNull(homeVisitAreas.deletedAt),
          eq(homeVisitAreas.tier, "primary"),
        ),
      );
    conditions.push(inArray(users.id, matchingUserIds));
  }

  // Round 3 step F — ancestor_ids containment, same "covers this area or
  // one above it" rule matching already applies (referral-matching.ts's
  // matchByHomeVisitCoverage): a therapist whose primary coverage row is
  // a whole zone/city matches every locality filter within it, not just
  // an exact-id row. filters.areaId can itself be a zone or a locality
  // (the directory's location filter now comes from a city-scoped tree,
  // not a flat locality-only list).
  if (filters.areaId) {
    const [filterArea] = await db
      .select({ ancestorIds: areas.ancestorIds })
      .from(areas)
      .where(eq(areas.id, filters.areaId));
    const coveringAreaIds = [filters.areaId, ...(filterArea?.ancestorIds ?? [])];
    const matchingUserIds = db
      .select({ userId: homeVisitAreas.userId })
      .from(homeVisitAreas)
      .where(
        and(
          inArray(homeVisitAreas.areaId, coveringAreaIds),
          isNull(homeVisitAreas.deletedAt),
          eq(homeVisitAreas.tier, "primary"),
        ),
      );
    conditions.push(inArray(users.id, matchingUserIds));
  }

  // Institution/certification — matched via an approved credential or
  // completion, never free text (§9: "matches on the linked credential,
  // not a free-text scan").
  if (filters.institutionId) {
    const matchingUserIds = db
      .select({ userId: credentials.userId })
      .from(credentials)
      .where(
        and(
          eq(credentials.institutionId, filters.institutionId),
          eq(credentials.status, "approved"),
          isNull(credentials.deletedAt),
        ),
      );
    conditions.push(inArray(users.id, matchingUserIds));
  }
  if (filters.courseId) {
    const matchingUserIds = db
      .select({ userId: courseCompletions.userId })
      .from(courseCompletions)
      .where(
        and(eq(courseCompletions.masterCourseId, filters.courseId), isNull(courseCompletions.deletedAt)),
      );
    conditions.push(inArray(users.id, matchingUserIds));
  }

  const rows = await db
    .select({
      id: users.id,
      slug: users.slug,
      displayName: users.displayName,
      photoUrl: users.photoUrl,
      role: users.role,
      specializations: users.specializations,
      verificationStage: users.verificationStage,
      capacityState: users.capacityState,
      availabilityUpdatedAt: users.availabilityUpdatedAt,
      teleRehabAvailable: users.teleRehabAvailable,
      bio: users.bio,
      languages: users.languages,
      yearsExperience: users.yearsExperience,
      ageGroupsServed: users.ageGroupsServed,
      availabilityNotes: users.availabilityNotes,
    })
    .from(users)
    .where(and(...conditions));

  // One representative home-visit area per profile, for card display —
  // deliberately not the filter's area (a therapist can serve several).
  // Step 5 [decision 11]: curationStatus = 'approved' excludes a
  // Places-fallback area still awaiting review — a therapist whose only
  // area on file is pending falls back to localityLabel: null rather
  // than displaying an unreviewed locality name.
  const userIds = rows.map((r) => r.id);
  const localityRows =
    userIds.length > 0
      ? await db
          .select({ userId: homeVisitAreas.userId, areaName: areas.name })
          .from(homeVisitAreas)
          .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
          .where(
            and(
              inArray(homeVisitAreas.userId, userIds),
              isNull(homeVisitAreas.deletedAt),
              eq(homeVisitAreas.tier, "primary"),
              eq(areas.curationStatus, "approved"),
              eq(areas.isActive, true),
            ),
          )
      : [];
  const localityByUserId = new Map<string, string>();
  for (const row of localityRows) {
    if (!localityByUserId.has(row.userId)) localityByUserId.set(row.userId, row.areaName);
  }

  // Phase 3 fix — same batched-secondary-query shape as localityRows
  // above, for the same reason ProfileCard needs it: the badge tooltip's
  // dateLabel.
  const verifiedSinceRows =
    userIds.length > 0
      ? await db
          .select({ userId: credentials.userId, verifiedSince: max(credentials.verifiedAt) })
          .from(credentials)
          .where(and(inArray(credentials.userId, userIds), eq(credentials.status, "approved")))
          .groupBy(credentials.userId)
      : [];
  const verifiedSinceByUserId = new Map<string, Date | null>();
  for (const row of verifiedSinceRows) {
    verifiedSinceByUserId.set(row.userId, row.verifiedSince);
  }

  return rows
    .map((row) => ({
      ...row,
      _completeness: profileCompletenessScore(row),
      _random: Math.random(),
    }))
    .sort((a, b) => {
      const tierDiff = TIER_RANK[a.verificationStage] - TIER_RANK[b.verificationStage];
      if (tierDiff !== 0) return tierDiff;

      if (a.capacityState !== b.capacityState) {
        return CAPACITY_RANK[a.capacityState as keyof typeof CAPACITY_RANK] - CAPACITY_RANK[b.capacityState as keyof typeof CAPACITY_RANK];
      }
      const aTime = a.availabilityUpdatedAt?.getTime() ?? 0;
      const bTime = b.availabilityUpdatedAt?.getTime() ?? 0;
      if (aTime !== bTime) return bTime - aTime;

      if (a._completeness !== b._completeness) return b._completeness - a._completeness;

      return a._random - b._random;
    })
    .map((row) => {
      const profile: DirectoryProfile = {
        id: row.id,
        slug: row.slug,
        displayName: row.displayName,
        photoUrl: row.photoUrl,
        role: row.role,
        specializations: row.specializations,
        verificationStage: row.verificationStage,
        capacityState: row.capacityState,
        availabilityUpdatedAt: row.availabilityUpdatedAt,
        verifiedSince: verifiedSinceByUserId.get(row.id) ?? null,
        teleRehabAvailable: row.teleRehabAvailable,
        localityLabel: localityByUserId.get(row.id) ?? null,
      };
      return profile;
    });
}

export interface TherapistSearchResult {
  id: string;
  slug: string | null;
  displayName: string | null;
  photoUrl: string | null;
  role: RoleNeededType | null;
  verificationStage: "unverified" | "qualification_confirmed" | "credentials_verified";
}

/** Phase 5 — name search for the circle member picker
 * (circle-members-manager.tsx), replacing "type the person's URL slug by
 * hand." Same eligibility filters as searchDirectory's default set
 * (active, public, real therapist accounts), but text-matched on
 * display_name rather than filter-matched — the two are complementary,
 * not a duplicate of searchDirectory's own taxonomy. Excludes the
 * caller's own row (adding yourself to your own circle isn't a real
 * case) and caps results since this backs a live-typing dropdown, not a
 * paginated list. */
export async function searchTherapistsByName(
  db: Db,
  query: string,
  excludeUserId: string,
): Promise<TherapistSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  return db
    .select({
      id: users.id,
      slug: users.slug,
      displayName: users.displayName,
      photoUrl: users.photoUrl,
      role: users.role,
      verificationStage: users.verificationStage,
    })
    .from(users)
    .where(
      and(
        eq(users.accountType, "therapist"),
        eq(users.profileStatus, "active"),
        eq(users.profileVisibility, "public"),
        isNull(users.deletedAt),
        sql`${users.id} != ${excludeUserId}`,
        sql`${users.displayName} ILIKE ${"%" + trimmed + "%"}`,
      ),
    )
    .limit(8);
}

export interface DirectoryCityOption {
  id: string;
  name: string;
}

/** Round 3 step F — the directory's bounded city filter (plan §6):
 * "cities with ≥1 listed therapist," never the whole national registry
 * a therapist's own onboarding CityPicker searches. Same base
 * eligibility as searchDirectory's default set. Two queries rather than
 * one join+groupBy, same shape as pledges.ts's getCityPledgeProgress —
 * simpler than threading a self-join alias through for city names. */
export async function getDirectoryCities(db: Db): Promise<DirectoryCityOption[]> {
  const coveredCityRows = await db
    .selectDistinct({ cityAreaId: areas.cityAreaId })
    .from(homeVisitAreas)
    .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
    .innerJoin(users, eq(users.id, homeVisitAreas.userId))
    .where(
      and(
        eq(homeVisitAreas.tier, "primary"),
        isNull(homeVisitAreas.deletedAt),
        eq(users.accountType, "therapist"),
        eq(users.profileStatus, "active"),
        eq(users.profileVisibility, "public"),
        isNull(users.deletedAt),
      ),
    );
  const cityIds = coveredCityRows
    .map((r) => r.cityAreaId)
    .filter((id): id is string => id !== null);
  if (cityIds.length === 0) return [];

  const cities = await db
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(inArray(areas.id, cityIds));
  return cities.sort((a, b) => a.name.localeCompare(b.name));
}
