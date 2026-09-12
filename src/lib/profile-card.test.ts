// Profile Card addendum — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { listDisplayCourses, listDisplayCredentials, listDisplayExperience } from "./profile-card";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdInstitutionIds: string[] = [];
const createdCouncilIds: string[] = [];
const createdCourseIds: string[] = [];
const createdPracticeIds: string[] = [];

afterEach(async () => {
  let practiceId: string | undefined;
  while ((practiceId = createdPracticeIds.pop()) !== undefined) {
    await client`DELETE FROM practice_users WHERE practice_id = ${practiceId}`;
    await client`DELETE FROM practices WHERE id = ${practiceId}`;
  }
  let courseId: string | undefined;
  while ((courseId = createdCourseIds.pop()) !== undefined) {
    await client`DELETE FROM course_completions WHERE master_course_id = ${courseId}`;
    await client`DELETE FROM master_courses_certifications WHERE id = ${courseId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM course_completions WHERE user_id = ${userId}`;
    await client`DELETE FROM credentials WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
  let institutionId: string | undefined;
  while ((institutionId = createdInstitutionIds.pop()) !== undefined) {
    await client`DELETE FROM master_institutions WHERE id = ${institutionId}`;
  }
  let councilId: string | undefined;
  while ((councilId = createdCouncilIds.pop()) !== undefined) {
    await client`DELETE FROM master_councils WHERE id = ${councilId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `profile-card-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function createInstitution(name: string): Promise<string> {
  const [row] = await client`
    INSERT INTO master_institutions (name, normalized_name) VALUES (${name}, ${name.toLowerCase()}) RETURNING id`;
  createdInstitutionIds.push(row.id);
  return row.id;
}

async function createCouncil(name: string, councilType: "statutory_registration" | "professional_association"): Promise<string> {
  const [row] = await client`
    INSERT INTO master_councils (name, council_type) VALUES (${name}, ${councilType}) RETURNING id`;
  createdCouncilIds.push(row.id);
  return row.id;
}

async function createMasterCourse(
  name: string,
  tier: "diploma" | "international_accredited_certification" | "other_workshop",
  hasFormalExamTrack: boolean | null,
): Promise<string> {
  const [row] = await client`
    INSERT INTO master_courses_certifications (name, normalized_name, category, tier, nomenclature, has_formal_exam_track)
    VALUES (${name}, ${name.toLowerCase() + crypto.randomUUID()}, 'other', ${tier}, ${name}, ${hasFormalExamTrack})
    RETURNING id`;
  createdCourseIds.push(row.id);
  return row.id;
}

describe("listDisplayCredentials (Profile Card addendum §5/§6)", () => {
  it("splits council registrations into statutory vs. professional association", async () => {
    const userId = await createUser();
    const statutoryId = await createCouncil(`TGPMB ${crypto.randomUUID()}`, "statutory_registration");
    const associationId = await createCouncil(`IAP ${crypto.randomUUID()}`, "professional_association");
    await client`INSERT INTO credentials (user_id, type, council_id, registration_number, status) VALUES (${userId}, 'council_registration', ${statutoryId}, '04471', 'approved')`;
    await client`INSERT INTO credentials (user_id, type, council_id, status) VALUES (${userId}, 'council_registration', ${associationId}, 'approved')`;

    const result = await listDisplayCredentials(db, userId);
    expect(result.statutoryRegistrations).toHaveLength(1);
    expect(result.statutoryRegistrations[0].registrationNumber).toBe("04471");
    expect(result.professionalAssociations).toHaveLength(1);
  });

  it("lists an approved degree with its institution name", async () => {
    const userId = await createUser();
    const institutionId = await createInstitution(`Manipal ${crypto.randomUUID()}`);
    await client`INSERT INTO credentials (user_id, type, institution_id, status) VALUES (${userId}, 'postgraduate_degree', ${institutionId}, 'approved')`;

    const result = await listDisplayCredentials(db, userId);
    expect(result.degrees).toHaveLength(1);
    expect(result.degrees[0].type).toBe("postgraduate_degree");
    expect(result.degrees[0].institutionName).toContain("Manipal");
  });

  it("never shows a pending or rejected credential", async () => {
    const userId = await createUser();
    const institutionId = await createInstitution(`Pending Inst ${crypto.randomUUID()}`);
    await client`INSERT INTO credentials (user_id, type, institution_id, status) VALUES (${userId}, 'degree', ${institutionId}, 'pending')`;

    const result = await listDisplayCredentials(db, userId);
    expect(result.degrees).toHaveLength(0);
  });
});

describe("listDisplayCourses (Profile Card addendum §7)", () => {
  it("tags a course as Certified only when the individual passed AND the master row has a formal exam track", async () => {
    const userId = await createUser();
    const examCourseId = await createMasterCourse(`Mulligan ${crypto.randomUUID()}`, "international_accredited_certification", true);
    await client`INSERT INTO course_completions (user_id, master_course_id, has_passed_exam, curation_status, calculated_tier) VALUES (${userId}, ${examCourseId}, true, 'approved', 'international_accredited_certification')`;

    const result = await listDisplayCourses(db, userId);
    expect(result.certified).toHaveLength(1);
    expect(result.advancedTraining).toHaveLength(0);
  });

  it("does not tag a course as Certified when the individual passed but the course itself has no formal exam track", async () => {
    const userId = await createUser();
    const noExamCourseId = await createMasterCourse(`Barral ${crypto.randomUUID()}`, "international_accredited_certification", false);
    await client`INSERT INTO course_completions (user_id, master_course_id, has_passed_exam, curation_status, calculated_tier) VALUES (${userId}, ${noExamCourseId}, true, 'approved', 'international_accredited_certification')`;

    const result = await listDisplayCourses(db, userId);
    expect(result.certified).toHaveLength(0);
    expect(result.advancedTraining).toHaveLength(1);
  });

  it("puts a non-exam institutional course under Advanced Training, not Courses & Workshops", async () => {
    const userId = await createUser();
    const courseId = await createMasterCourse(`Diploma ${crypto.randomUUID()}`, "diploma", false);
    await client`INSERT INTO course_completions (user_id, master_course_id, has_passed_exam, curation_status, calculated_tier) VALUES (${userId}, ${courseId}, false, 'approved', 'diploma')`;

    const result = await listDisplayCourses(db, userId);
    expect(result.advancedTraining).toHaveLength(1);
    expect(result.coursesWorkshops).toHaveLength(0);
  });

  it("puts a local workshop under Courses & Workshops", async () => {
    const userId = await createUser();
    const courseId = await createMasterCourse(`Local Workshop ${crypto.randomUUID()}`, "other_workshop", null);
    await client`INSERT INTO course_completions (user_id, master_course_id, has_passed_exam, curation_status, calculated_tier) VALUES (${userId}, ${courseId}, false, 'approved', 'other_workshop')`;

    const result = await listDisplayCourses(db, userId);
    expect(result.coursesWorkshops).toHaveLength(1);
  });

  it("excludes the synced degree placeholder row (no master_course_id) from every tier", async () => {
    const userId = await createUser();
    // Mirrors exactly what sync_degree_to_course_completion() inserts.
    await client`INSERT INTO course_completions (user_id, custom_course_name, calculated_nomenclature, curation_status) VALUES (${userId}, 'Graduation', 'Graduation', 'approved')`;

    const result = await listDisplayCourses(db, userId);
    expect(result.certified).toHaveLength(0);
    expect(result.advancedTraining).toHaveLength(0);
    expect(result.coursesWorkshops).toHaveLength(0);
  });

  it("excludes a course still pending curation", async () => {
    const userId = await createUser();
    const courseId = await createMasterCourse(`Pending course ${crypto.randomUUID()}`, "other_workshop", null);
    await client`INSERT INTO course_completions (user_id, master_course_id, curation_status) VALUES (${userId}, ${courseId}, 'pending_review')`;

    const result = await listDisplayCourses(db, userId);
    expect(result.coursesWorkshops).toHaveLength(0);
  });
});

describe("listDisplayExperience (Profile Card addendum §9)", () => {
  async function createPractice(
    name: string,
    googlePlaceId: string | null,
    createdByUserId: string,
    claimStatus: string = "unclaimed",
  ): Promise<string> {
    const [row] = await client`
      INSERT INTO practices (name, type, normalized_name, normalized_address, google_place_id, created_by_user_id, claim_status)
      VALUES (${name}, 'clinic', ${name.toLowerCase()}, 'addr', ${googlePlaceId}, ${createdByUserId}, ${claimStatus})
      RETURNING id`;
    createdPracticeIds.push(row.id);
    return row.id;
  }

  it("pins a current affiliation ahead of a past one", async () => {
    const userId = await createUser();
    const pastPracticeId = await createPractice(`Old Clinic ${crypto.randomUUID()}`, null, userId);
    const currentPracticeId = await createPractice(`Current Clinic ${crypto.randomUUID()}`, "place123", userId);
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by, is_public, started_at, ended_at)
      VALUES (${pastPracticeId}, ${userId}, 'staff', 'works_at', 'accepted', 'self', true, now() - interval '2 years', now() - interval '1 year')`;
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by, is_public, started_at)
      VALUES (${currentPracticeId}, ${userId}, 'staff', 'works_at', 'accepted', 'self', true, now() - interval '3 months')`;

    const result = await listDisplayExperience(db, userId);
    expect(result).toHaveLength(2);
    expect(result[0].isCurrent).toBe(true);
    expect(result[0].practiceName).toContain("Current Clinic");
    expect(result[1].isCurrent).toBe(false);
  });

  it("excludes a disputed affiliation", async () => {
    const userId = await createUser();
    const practiceId = await createPractice(`Disputed Clinic ${crypto.randomUUID()}`, null, userId);
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by, is_public, started_at, disputed_at, disputed_by_user_id)
      VALUES (${practiceId}, ${userId}, 'staff', 'works_at', 'accepted', 'practice', true, now(), now(), ${userId})`;

    const result = await listDisplayExperience(db, userId);
    expect(result).toHaveLength(0);
  });

  it("excludes an affiliation not marked public", async () => {
    const userId = await createUser();
    const practiceId = await createPractice(`Private Clinic ${crypto.randomUUID()}`, null, userId);
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by, is_public, started_at)
      VALUES (${practiceId}, ${userId}, 'staff', 'works_at', 'accepted', 'self', false, now())`;

    const result = await listDisplayExperience(db, userId);
    expect(result).toHaveLength(0);
  });

  it("excludes a pending (not yet accepted) affiliation", async () => {
    const userId = await createUser();
    const practiceId = await createPractice(`Pending Clinic ${crypto.randomUUID()}`, null, userId);
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by, is_public, started_at)
      VALUES (${practiceId}, ${userId}, 'staff', 'works_at', 'pending', 'practice', true, now())`;

    const result = await listDisplayExperience(db, userId);
    expect(result).toHaveLength(0);
  });

  it("carries the google_place_id through for map-link treatment", async () => {
    const userId = await createUser();
    const practiceId = await createPractice(`Mapped Clinic ${crypto.randomUUID()}`, "place-xyz", userId);
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by, is_public, started_at)
      VALUES (${practiceId}, ${userId}, 'staff', 'works_at', 'accepted', 'self', true, now())`;

    const result = await listDisplayExperience(db, userId);
    expect(result[0].googlePlaceId).toBe("place-xyz");
  });

  // §11: the "Unclaimed listing" label is driven by claim_status, never by
  // googlePlaceId — a Places-matched practice can still be unclaimed, and
  // the two facts must not be conflated into one flag.
  it("carries claim_status through independent of google_place_id", async () => {
    const userId = await createUser();
    const claimedMappedId = await createPractice(`Claimed Mapped ${crypto.randomUUID()}`, "place-1", userId, "claimed");
    const unclaimedMappedId = await createPractice(`Unclaimed Mapped ${crypto.randomUUID()}`, "place-2", userId, "unclaimed");
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by, is_public, started_at)
      VALUES (${claimedMappedId}, ${userId}, 'staff', 'works_at', 'accepted', 'self', true, now())`;
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by, is_public, started_at)
      VALUES (${unclaimedMappedId}, ${userId}, 'staff', 'works_at', 'accepted', 'self', true, now())`;

    const result = await listDisplayExperience(db, userId);
    const claimed = result.find((r) => r.practiceName.startsWith("Claimed Mapped"));
    const unclaimed = result.find((r) => r.practiceName.startsWith("Unclaimed Mapped"));
    expect(claimed?.claimStatus).toBe("claimed");
    expect(unclaimed?.claimStatus).toBe("unclaimed");
  });
});
