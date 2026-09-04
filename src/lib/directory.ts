// §9 — the public directory's filter taxonomy and sort order. Filters
// narrow the result set; they NEVER change the order (plan §9: no filter,
// now or later, ever introduces a user-selectable sort — this fixed order
// is unconditional regardless of which filters are active):
//   1. Credentials Verified > Qualification Confirmed > Unverified
//   2. Availability recency (available_for_new_patients, then
//      availability_updated_at descending)
//   3. Profile completeness (internal ordering input only, never shown —
//      see profile-completeness.ts)
//   4. Randomised tiebreak
//
// [E4] verifiedOnly defaults OFF everywhere — hiding qualification_confirmed
// profiles would hide the exact audience §8A1a invented that tier for.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/db";
import {
  users,
  homeVisitAreas,
  areas,
  credentials,
  courseCompletions,
  type roleNeededTypeEnum,
  type specializationTypeEnum,
  type genderTypeEnum,
  type ageGroupTypeEnum,
} from "@/db/schema";
import { profileCompletenessScore } from "./profile-completeness";

type RoleNeededType = (typeof roleNeededTypeEnum.enumValues)[number];
type SpecializationType = (typeof specializationTypeEnum.enumValues)[number];
type GenderType = (typeof genderTypeEnum.enumValues)[number];
type AgeGroupType = (typeof ageGroupTypeEnum.enumValues)[number];

export type ExperienceBucket = "0-2" | "3-5" | "6-10" | "10+";

export interface DirectoryFilters {
  // Default filters (§9)
  role?: RoleNeededType;
  areaId?: string;
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
  availableForNewPatients: boolean;
  teleRehabAvailable: boolean;
  /** One of the therapist's own home-visit areas (not the filter's), for card display. */
  localityLabel: string | null;
}

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

  if (filters.areaId) {
    const matchingUserIds = db
      .select({ userId: homeVisitAreas.userId })
      .from(homeVisitAreas)
      .where(and(eq(homeVisitAreas.areaId, filters.areaId), isNull(homeVisitAreas.deletedAt)));
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
      availableForNewPatients: users.availableForNewPatients,
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
  const userIds = rows.map((r) => r.id);
  const localityRows =
    userIds.length > 0
      ? await db
          .select({ userId: homeVisitAreas.userId, areaName: areas.name })
          .from(homeVisitAreas)
          .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
          .where(and(inArray(homeVisitAreas.userId, userIds), isNull(homeVisitAreas.deletedAt)))
      : [];
  const localityByUserId = new Map<string, string>();
  for (const row of localityRows) {
    if (!localityByUserId.has(row.userId)) localityByUserId.set(row.userId, row.areaName);
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

      if (a.availableForNewPatients !== b.availableForNewPatients) {
        return a.availableForNewPatients ? -1 : 1;
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
        availableForNewPatients: row.availableForNewPatients,
        teleRehabAvailable: row.teleRehabAvailable,
        localityLabel: localityByUserId.get(row.id) ?? null,
      };
      return profile;
    });
}
