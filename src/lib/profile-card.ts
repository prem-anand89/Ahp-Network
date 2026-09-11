// Profile Card addendum — read-only display queries for the full profile
// card (both the public /pt/[slug] page and the therapist's own
// /app/profile). Nothing here writes anything or feeds referral matching,
// verification gating, or any other locked P0 mechanic (§8D's matching
// filter reads users.role/users.specializations only, never these tables).
//
// Degrees are shown ONLY from the dedicated Degrees section below, sourced
// directly from `credentials` — not from the synced course_completions
// placeholder row sync_degree_to_course_completion() creates on approval
// (drizzle/0010). That sync exists for a different reason (older schema
// versions before this dedicated section existed) and its rows carry no
// master_course_id and no calculated_tier, so listDisplayCourses below
// naturally excludes them by requiring master_course_id IS NOT NULL. This
// is a deliberate simplification, not silent drift: the Profile Card
// addendum's finding 3 flagged exactly this as open, and the dedicated
// Degrees section is the answer — a degree renders once, never duplicated
// under Courses & Certifications.
//
// Known gap, flagged rather than silently worked around: there is
// currently no therapist-facing flow anywhere in the app that inserts a
// real (master_course_id-linked) course_completions row — only the
// degree-sync function and admin curation actions write this table today.
// listDisplayCourses is therefore correct once that submission flow
// exists, but will show an empty Courses & Certifications section for
// every therapist until it's built. That flow is out of scope here.

import { and, desc, eq, isNull } from "drizzle-orm";
import {
  credentials,
  masterCouncils,
  masterInstitutions,
  courseCompletions,
  masterCoursesCertifications,
  practiceUsers,
  practices,
} from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

// ---------------------------------------------------------------------------
// Credentials — §5/§6: Memberships & Registrations (statutory vs.
// professional association, §8A1a's council_type split) and Degrees, as
// two visually and structurally distinct sections, never merged into one
// flat "Credentials" list. Only §5's council split gates
// credentials_verified (§8A1a) — that gating logic lives in
// recompute_verification_stage(), unchanged by this file, which is
// read-only display.
// ---------------------------------------------------------------------------

export interface DisplayDegree {
  id: string;
  type: "degree" | "postgraduate_degree";
  institutionName: string | null;
  verifiedAt: Date | null;
}

export interface DisplayCouncilRegistration {
  id: string;
  councilName: string;
  state: string | null;
  registrationNumber: string | null;
  verifiedAt: Date | null;
}

export interface DisplayCredentials {
  degrees: DisplayDegree[];
  statutoryRegistrations: DisplayCouncilRegistration[];
  professionalAssociations: DisplayCouncilRegistration[];
}

export async function listDisplayCredentials(db: Db, userId: string): Promise<DisplayCredentials> {
  const degreeRows = await db
    .select({
      id: credentials.id,
      type: credentials.type,
      institutionName: masterInstitutions.name,
      verifiedAt: credentials.verifiedAt,
    })
    .from(credentials)
    .leftJoin(masterInstitutions, eq(masterInstitutions.id, credentials.institutionId))
    .where(
      and(
        eq(credentials.userId, userId),
        eq(credentials.status, "approved"),
        isNull(credentials.deletedAt),
        // degree/postgraduate_degree only — council_registration is handled below.
        eq(credentials.type, "degree"),
      ),
    );

  const pgDegreeRows = await db
    .select({
      id: credentials.id,
      type: credentials.type,
      institutionName: masterInstitutions.name,
      verifiedAt: credentials.verifiedAt,
    })
    .from(credentials)
    .leftJoin(masterInstitutions, eq(masterInstitutions.id, credentials.institutionId))
    .where(
      and(
        eq(credentials.userId, userId),
        eq(credentials.status, "approved"),
        isNull(credentials.deletedAt),
        eq(credentials.type, "postgraduate_degree"),
      ),
    );

  const councilRows = await db
    .select({
      id: credentials.id,
      councilName: masterCouncils.name,
      councilType: masterCouncils.councilType,
      state: masterCouncils.state,
      registrationNumber: credentials.registrationNumber,
      verifiedAt: credentials.verifiedAt,
    })
    .from(credentials)
    .innerJoin(masterCouncils, eq(masterCouncils.id, credentials.councilId))
    .where(
      and(
        eq(credentials.userId, userId),
        eq(credentials.status, "approved"),
        isNull(credentials.deletedAt),
        eq(credentials.type, "council_registration"),
      ),
    );

  const toDegree = (r: (typeof degreeRows)[number]): DisplayDegree => ({
    id: r.id,
    type: r.type as "degree" | "postgraduate_degree",
    institutionName: r.institutionName,
    verifiedAt: r.verifiedAt,
  });

  const statutoryRegistrations: DisplayCouncilRegistration[] = [];
  const professionalAssociations: DisplayCouncilRegistration[] = [];
  for (const r of councilRows) {
    const row: DisplayCouncilRegistration = {
      id: r.id,
      councilName: r.councilName,
      state: r.state,
      registrationNumber: r.registrationNumber,
      verifiedAt: r.verifiedAt,
    };
    // §5: text-only distinction, never a checkmark — the plan locks
    // exactly three trust badges and this must never read as a fourth.
    if (r.councilType === "statutory_registration") {
      statutoryRegistrations.push(row);
    } else {
      professionalAssociations.push(row);
    }
  }

  return {
    degrees: [...degreeRows, ...pgDegreeRows].map(toDegree),
    statutoryRegistrations,
    professionalAssociations,
  };
}

// ---------------------------------------------------------------------------
// Courses — §7: three visible tiers, a display split of course_completions'
// existing calculated_tier + the individual's hasPassedExam, not new
// classification logic. "Certified" requires BOTH the individual having
// passed AND the master course actually having a formal exam track —
// never hasPassedExam alone, which would let a self-report on a course
// with no exam invent a certification.
// ---------------------------------------------------------------------------

export interface DisplayCourse {
  id: string;
  name: string;
  completionYear: number | null;
}

export interface DisplayCourses {
  certified: DisplayCourse[];
  advancedTraining: DisplayCourse[];
  coursesWorkshops: DisplayCourse[];
}

export async function listDisplayCourses(db: Db, userId: string): Promise<DisplayCourses> {
  const rows = await db
    .select({
      id: courseCompletions.id,
      name: masterCoursesCertifications.name,
      completionYear: courseCompletions.completionYear,
      hasPassedExam: courseCompletions.hasPassedExam,
      calculatedTier: courseCompletions.calculatedTier,
      hasFormalExamTrack: masterCoursesCertifications.hasFormalExamTrack,
    })
    .from(courseCompletions)
    .innerJoin(masterCoursesCertifications, eq(masterCoursesCertifications.id, courseCompletions.masterCourseId))
    .where(
      and(
        eq(courseCompletions.userId, userId),
        eq(courseCompletions.curationStatus, "approved"),
        isNull(courseCompletions.deletedAt),
      ),
    );

  const certified: DisplayCourse[] = [];
  const advancedTraining: DisplayCourse[] = [];
  const coursesWorkshops: DisplayCourse[] = [];

  for (const r of rows) {
    const course: DisplayCourse = { id: r.id, name: r.name, completionYear: r.completionYear };
    if (r.hasPassedExam && r.hasFormalExamTrack) {
      certified.push(course);
    } else if (r.calculatedTier === "diploma" || r.calculatedTier === "international_accredited_certification") {
      advancedTraining.push(course);
    } else {
      coursesWorkshops.push(course);
    }
  }

  return { certified, advancedTraining, coursesWorkshops };
}

// ---------------------------------------------------------------------------
// Experience — §9: one reverse-chronological timeline, current entries
// pinned first, not two separate "current"/"past" sections. Mirrors the
// predicate the /clinic/[slug] page already uses in the reverse direction
// (practice -> its affiliated users), with the disputed_at filter that
// predicate's own index comment calls for and that page didn't need.
// ---------------------------------------------------------------------------

export interface DisplayExperience {
  id: string;
  practiceName: string;
  practiceSlug: string | null;
  displayTitle: string | null;
  formattedAddress: string | null;
  googlePlaceId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  isCurrent: boolean;
}

export async function listDisplayExperience(db: Db, userId: string): Promise<DisplayExperience[]> {
  const rows = await db
    .select({
      id: practiceUsers.id,
      practiceName: practices.name,
      practiceSlug: practices.slug,
      displayTitle: practiceUsers.displayTitle,
      formattedAddress: practices.formattedAddress,
      googlePlaceId: practices.googlePlaceId,
      startedAt: practiceUsers.startedAt,
      endedAt: practiceUsers.endedAt,
    })
    .from(practiceUsers)
    .innerJoin(practices, eq(practices.id, practiceUsers.practiceId))
    .where(
      and(
        eq(practiceUsers.userId, userId),
        eq(practiceUsers.consentStatus, "accepted"),
        eq(practiceUsers.isPublic, true),
        isNull(practiceUsers.disputedAt),
        isNull(practiceUsers.deletedAt),
        isNull(practices.deletedAt),
      ),
    )
    .orderBy(desc(practiceUsers.startedAt));

  // Current entries (endedAt IS NULL) pinned first, most-recently-
  // started first within each group — a plain re-sort over the already
  // date-ordered rows above, not a second query.
  const current = rows.filter((r) => r.endedAt === null);
  const past = rows.filter((r) => r.endedAt !== null);

  return [...current, ...past].map((r) => ({ ...r, isCurrent: r.endedAt === null }));
}
