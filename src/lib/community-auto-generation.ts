// §8E3 — weekly auto-generation of institution, certification, and
// workplace communities. Runs from the existing weekly-digest cron route
// (§8E3 itself: "no new infrastructure category" — this reuses that slot
// rather than a sixth Cloudflare Cron Trigger, which the free plan's
// 5-trigger cap wouldn't allow anyway).
//
// [H3] Gated behind the same ≥100-verified-active-therapists-per-city
// macro gate as recruiting (§2), and each type's own density
// sub-threshold — the gate exists specifically to stop this job spawning
// communities that open with two members and read as abandoned. Build it
// and test the gating; it simply will not fire during the pilot.
//
// Single-city pilot note: §2's gate is "per city," but no per-user city
// column exists yet (areas is a matching tree, not a user attribute) and
// only one city (Hyderabad) is seeded — so the count below is
// platform-wide, which is exactly "in the city" until a second city
// exists. Do not add city scoping ahead of actually having a second city
// (CLAUDE.md: no multi-city infrastructure before it's needed).

import { and, eq, gte, isNull, sql } from "drizzle-orm";
import {
  communities,
  courseCompletions,
  credentials,
  masterCoursesCertifications,
  masterInstitutions,
  practiceUsers,
  practices,
  users,
} from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export const COMMUNITY_AUTO_GEN_MACRO_GATE = 100;
const INSTITUTION_SUB_THRESHOLD = 5;
const CERTIFICATION_SUB_THRESHOLD = 5;
const WORKPLACE_MIN_AFFILIATIONS = 2;

/** §2's gate: verified (either tier), non-deleted therapists. Platform-wide
 * — see the single-city note above. */
export async function countVerifiedActiveTherapists(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.accountType, "therapist"),
        sql`${users.verificationStage} != 'unverified'`,
        isNull(users.deletedAt),
      ),
    );
  return row?.n ?? 0;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "community"
  );
}

async function uniqueCommunitySlug(db: Db, base: string): Promise<string> {
  const stem = slugify(base);
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? stem : `${stem}-${attempt + 1}`;
    const [existing] = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, candidate));
    if (!existing) return candidate;
  }
}

async function institutionCommunityExists(db: Db, institutionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: communities.id })
    .from(communities)
    .where(
      and(
        eq(communities.origin, "auto_generated_institution"),
        eq(communities.sourceInstitutionId, institutionId),
        isNull(communities.deletedAt),
      ),
    );
  return Boolean(row);
}

async function certificationCommunityExists(db: Db, courseId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: communities.id })
    .from(communities)
    .where(
      and(
        eq(communities.origin, "auto_generated_certification"),
        eq(communities.sourceCourseId, courseId),
        isNull(communities.deletedAt),
      ),
    );
  return Boolean(row);
}

interface GenerationResult {
  gated: boolean;
  verifiedActiveTherapists: number;
  institutionCommunitiesCreated: number;
  certificationCommunitiesCreated: number;
  workplaceCommunitiesCreated: number;
  workplaceCommunitiesDeactivated: number;
}

/** ≥5 verified therapists sharing an approved institution, via an approved
 * degree/postgraduate_degree credential — the same eligibility §8A1a
 * already uses for qualification_confirmed, not free-text institution
 * names. */
export async function generateInstitutionCommunities(db: Db): Promise<number> {
  const groups = await db
    .select({
      institutionId: credentials.institutionId,
      institutionName: masterInstitutions.name,
      therapistCount: sql<number>`count(distinct ${credentials.userId})::int`,
    })
    .from(credentials)
    .innerJoin(masterInstitutions, eq(masterInstitutions.id, credentials.institutionId))
    .innerJoin(users, eq(users.id, credentials.userId))
    .where(
      and(
        sql`${credentials.type} IN ('degree', 'postgraduate_degree')`,
        eq(credentials.status, "approved"),
        isNull(credentials.deletedAt),
        eq(masterInstitutions.curationStatus, "approved"),
        eq(masterInstitutions.isActive, true),
        eq(users.accountType, "therapist"),
        sql`${users.verificationStage} != 'unverified'`,
        isNull(users.deletedAt),
      ),
    )
    .groupBy(credentials.institutionId, masterInstitutions.name)
    .having(gte(sql`count(distinct ${credentials.userId})`, INSTITUTION_SUB_THRESHOLD));

  let created = 0;
  for (const group of groups) {
    if (!group.institutionId) continue;
    if (await institutionCommunityExists(db, group.institutionId)) continue;
    const slug = await uniqueCommunitySlug(db, group.institutionName);
    await db.insert(communities).values({
      name: group.institutionName,
      slug,
      type: "platform_official",
      status: "active",
      origin: "auto_generated_institution",
      sourceInstitutionId: group.institutionId,
    });
    created++;
  }
  return created;
}

/** Same mechanism, scoped to the admin-curated international-certification
 * allow-list (master_courses_certifications.eligible_for_community_auto_generation),
 * never every row in the taxonomy. */
export async function generateCertificationCommunities(db: Db): Promise<number> {
  const groups = await db
    .select({
      courseId: courseCompletions.masterCourseId,
      courseName: masterCoursesCertifications.name,
      therapistCount: sql<number>`count(distinct ${courseCompletions.userId})::int`,
    })
    .from(courseCompletions)
    .innerJoin(masterCoursesCertifications, eq(masterCoursesCertifications.id, courseCompletions.masterCourseId))
    .innerJoin(users, eq(users.id, courseCompletions.userId))
    .where(
      and(
        eq(courseCompletions.curationStatus, "approved"),
        isNull(courseCompletions.deletedAt),
        eq(masterCoursesCertifications.eligibleForCommunityAutoGeneration, true),
        eq(masterCoursesCertifications.isActive, true),
        eq(users.accountType, "therapist"),
        sql`${users.verificationStage} != 'unverified'`,
        isNull(users.deletedAt),
      ),
    )
    .groupBy(courseCompletions.masterCourseId, masterCoursesCertifications.name)
    .having(gte(sql`count(distinct ${courseCompletions.userId})`, CERTIFICATION_SUB_THRESHOLD));

  let created = 0;
  for (const group of groups) {
    if (!group.courseId) continue;
    if (await certificationCommunityExists(db, group.courseId)) continue;
    const slug = await uniqueCommunitySlug(db, group.courseName);
    await db.insert(communities).values({
      name: group.courseName,
      slug,
      type: "platform_official",
      status: "active",
      origin: "auto_generated_certification",
      sourceCourseId: group.courseId,
    });
    created++;
  }
  return created;
}

/** Claimed practice + ≥2 accepted affiliations → auto-enrolled workplace
 * community (membership itself is never stored — practice_community_members,
 * drizzle/0027). If a previously-generated workplace community's practice
 * later becomes unclaimed or drops below the threshold, it goes dormant
 * (soft-deactivated to 'closed', never deleted) rather than staying live
 * with a membership view that's quietly emptied out. */
export async function generateAndMaintainWorkplaceCommunities(
  db: Db,
): Promise<{ created: number; deactivated: number }> {
  const eligible = await db
    .select({
      practiceId: practices.id,
      practiceName: practices.name,
      affiliationCount: sql<number>`count(*)::int`,
    })
    .from(practices)
    .innerJoin(
      practiceUsers,
      and(
        eq(practiceUsers.practiceId, practices.id),
        eq(practiceUsers.consentStatus, "accepted"),
        isNull(practiceUsers.endedAt),
        isNull(practiceUsers.deletedAt),
      ),
    )
    .where(and(eq(practices.claimStatus, "claimed"), isNull(practices.deletedAt)))
    .groupBy(practices.id, practices.name)
    .having(gte(sql`count(*)`, WORKPLACE_MIN_AFFILIATIONS));

  let created = 0;
  for (const practice of eligible) {
    const [existing] = await db
      .select({ id: communities.id, status: communities.status })
      .from(communities)
      .where(and(eq(communities.origin, "auto_generated_practice"), eq(communities.sourcePracticeId, practice.practiceId)));

    if (!existing) {
      const slug = await uniqueCommunitySlug(db, practice.practiceName);
      await db.insert(communities).values({
        name: practice.practiceName,
        slug,
        type: "platform_official",
        status: "active",
        origin: "auto_generated_practice",
        sourcePracticeId: practice.practiceId,
      });
      created++;
    } else if (existing.status === "closed") {
      // Practice re-qualified (re-claimed, or affiliations grew back) —
      // reopen rather than creating a duplicate community.
      await db.update(communities).set({ status: "active" }).where(eq(communities.id, existing.id));
    }
  }

  // Dormancy: any active workplace community whose practice no longer
  // qualifies (unclaimed, or affiliation count dropped below 2).
  const eligiblePracticeIds = new Set(eligible.map((e) => e.practiceId));
  const activeWorkplace = await db
    .select({ id: communities.id, sourcePracticeId: communities.sourcePracticeId })
    .from(communities)
    .where(and(eq(communities.origin, "auto_generated_practice"), eq(communities.status, "active")));

  let deactivated = 0;
  for (const community of activeWorkplace) {
    if (community.sourcePracticeId && !eligiblePracticeIds.has(community.sourcePracticeId)) {
      await db.update(communities).set({ status: "closed" }).where(eq(communities.id, community.id));
      deactivated++;
    }
  }

  return { created, deactivated };
}

export async function runCommunityAutoGeneration(db: Db): Promise<GenerationResult> {
  const verifiedActiveTherapists = await countVerifiedActiveTherapists(db);

  if (verifiedActiveTherapists < COMMUNITY_AUTO_GEN_MACRO_GATE) {
    return {
      gated: true,
      verifiedActiveTherapists,
      institutionCommunitiesCreated: 0,
      certificationCommunitiesCreated: 0,
      workplaceCommunitiesCreated: 0,
      workplaceCommunitiesDeactivated: 0,
    };
  }

  const institutionCommunitiesCreated = await generateInstitutionCommunities(db);
  const certificationCommunitiesCreated = await generateCertificationCommunities(db);
  const workplace = await generateAndMaintainWorkplaceCommunities(db);

  return {
    gated: false,
    verifiedActiveTherapists,
    institutionCommunitiesCreated,
    certificationCommunitiesCreated,
    workplaceCommunitiesCreated: workplace.created,
    workplaceCommunitiesDeactivated: workplace.deactivated,
  };
}
