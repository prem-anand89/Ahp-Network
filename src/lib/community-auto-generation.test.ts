// §8E3 — [H3] the ≥100-verified-active-therapists macro gate, on top of
// each type's own density sub-threshold. Runs against real local
// Postgres, never mocks.
//
// Seeding 100 real therapist rows just to exercise the macro gate in
// every test would be slow and wouldn't test anything the direct
// countVerifiedActiveTherapists assertions below don't already cover, so
// the sub-threshold tests call the individual generateXCommunities
// functions directly — proving the density logic is correct independent
// of whichever count the macro gate happens to be at in this database.
// runCommunityAutoGeneration's own gating (the ≥100 check itself) is
// tested against this database's real, comfortably-sub-100 count.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  COMMUNITY_AUTO_GEN_MACRO_GATE,
  countVerifiedActiveTherapists,
  generateAndMaintainWorkplaceCommunities,
  generateCertificationCommunities,
  generateInstitutionCommunities,
  runCommunityAutoGeneration,
} from "./community-auto-generation";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdCommunityIds: string[] = [];
const createdInstitutionIds: string[] = [];
const createdCourseIds: string[] = [];
const createdPracticeIds: string[] = [];

afterEach(async () => {
  let practiceId: string | undefined;
  while ((practiceId = createdPracticeIds.pop()) !== undefined) {
    await client`DELETE FROM practice_users WHERE practice_id = ${practiceId}`;
    await client`DELETE FROM practices WHERE id = ${practiceId}`;
  }
  let communityId: string | undefined;
  while ((communityId = createdCommunityIds.pop()) !== undefined) {
    await client`DELETE FROM communities WHERE id = ${communityId}`;
  }
  let courseId: string | undefined;
  while ((courseId = createdCourseIds.pop()) !== undefined) {
    await client`DELETE FROM course_completions WHERE master_course_id = ${courseId}`;
    await client`DELETE FROM master_courses_certifications WHERE id = ${courseId}`;
  }
  let institutionId: string | undefined;
  while ((institutionId = createdInstitutionIds.pop()) !== undefined) {
    await client`DELETE FROM credentials WHERE institution_id = ${institutionId}`;
    await client`DELETE FROM master_institutions WHERE id = ${institutionId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createVerifiedTherapist(): Promise<string> {
  const email = `autogen-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, verification_stage)
    VALUES (${authUser.id}, ${email}, 'therapist', 'credentials_verified')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("countVerifiedActiveTherapists", () => {
  it("counts only verified (either tier), non-deleted therapists", async () => {
    const before = await countVerifiedActiveTherapists(db);
    const verified = await createVerifiedTherapist();

    const email = `unverified-${crypto.randomUUID()}@test.local`;
    const [unverifiedAuth] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
    await client`INSERT INTO users (id, email, account_type, verification_stage) VALUES (${unverifiedAuth.id}, ${email}, 'therapist', 'unverified')`;
    createdUserIds.push(unverifiedAuth.id);

    const after = await countVerifiedActiveTherapists(db);
    expect(after).toBe(before + 1);
    expect(verified).toBeTruthy();
  });
});

describe("runCommunityAutoGeneration — macro gate", () => {
  it("is gated in this test database, which is nowhere near 100 verified therapists", async () => {
    const result = await runCommunityAutoGeneration(db);
    expect(result.gated).toBe(true);
    expect(result.verifiedActiveTherapists).toBeLessThan(COMMUNITY_AUTO_GEN_MACRO_GATE);
    expect(result.institutionCommunitiesCreated).toBe(0);
    expect(result.certificationCommunitiesCreated).toBe(0);
    expect(result.workplaceCommunitiesCreated).toBe(0);
  });
});

describe("generateInstitutionCommunities — sub-threshold (§8E3: ≥5 verified therapists)", () => {
  it("does not create a community below the threshold", async () => {
    const [institution] = await client<{ id: string }[]>`
      INSERT INTO master_institutions (name, normalized_name) VALUES (${"Below Threshold Institute " + crypto.randomUUID()}, 'x') RETURNING id`;
    createdInstitutionIds.push(institution.id);

    for (let i = 0; i < 4; i++) {
      const therapist = await createVerifiedTherapist();
      await client`
        INSERT INTO credentials (user_id, type, institution_id, status)
        VALUES (${therapist}, 'degree', ${institution.id}, 'approved')`;
    }

    const created = await generateInstitutionCommunities(db);
    expect(created).toBe(0);
    const [row] = await client`SELECT id FROM communities WHERE source_institution_id = ${institution.id}`;
    expect(row).toBeUndefined();
  });

  it("creates exactly one community once ≥5 verified therapists share an institution, and is idempotent on a second run", async () => {
    const [institution] = await client<{ id: string }[]>`
      INSERT INTO master_institutions (name, normalized_name) VALUES (${"At Threshold Institute " + crypto.randomUUID()}, 'x') RETURNING id`;
    createdInstitutionIds.push(institution.id);

    for (let i = 0; i < 5; i++) {
      const therapist = await createVerifiedTherapist();
      await client`
        INSERT INTO credentials (user_id, type, institution_id, status)
        VALUES (${therapist}, 'degree', ${institution.id}, 'approved')`;
    }

    const created = await generateInstitutionCommunities(db);
    expect(created).toBe(1);
    const [row] = await client<{ id: string }[]>`SELECT id FROM communities WHERE source_institution_id = ${institution.id}`;
    expect(row).toBeDefined();
    createdCommunityIds.push(row.id);

    const secondRun = await generateInstitutionCommunities(db);
    expect(secondRun).toBe(0); // no duplicate
    const rows = await client`SELECT id FROM communities WHERE source_institution_id = ${institution.id}`;
    expect(rows).toHaveLength(1);
  });
});

describe("generateCertificationCommunities — allow-list + sub-threshold", () => {
  it("does not create a community for a certification outside the allow-list, even above the threshold", async () => {
    const [course] = await client<{ id: string }[]>`
      INSERT INTO master_courses_certifications (name, normalized_name, category, tier, nomenclature, eligible_for_community_auto_generation)
      VALUES (${"Non-allow-listed Workshop " + crypto.randomUUID()}, 'x', 'other', 'other_workshop', 'x', false) RETURNING id`;
    createdCourseIds.push(course.id);

    for (let i = 0; i < 6; i++) {
      const therapist = await createVerifiedTherapist();
      await client`
        INSERT INTO course_completions (user_id, master_course_id, curation_status)
        VALUES (${therapist}, ${course.id}, 'approved')`;
    }

    const created = await generateCertificationCommunities(db);
    expect(created).toBe(0);
  });

  it("creates a community once an allow-listed certification crosses the threshold", async () => {
    const [course] = await client<{ id: string }[]>`
      INSERT INTO master_courses_certifications (name, normalized_name, category, tier, nomenclature, eligible_for_community_auto_generation)
      VALUES (${"Mulligan Concept " + crypto.randomUUID()}, 'x', 'manual_therapy', 'international_accredited_certification', 'x', true) RETURNING id`;
    createdCourseIds.push(course.id);

    for (let i = 0; i < 5; i++) {
      const therapist = await createVerifiedTherapist();
      await client`
        INSERT INTO course_completions (user_id, master_course_id, curation_status)
        VALUES (${therapist}, ${course.id}, 'approved')`;
    }

    const created = await generateCertificationCommunities(db);
    expect(created).toBe(1);
    const [row] = await client<{ id: string }[]>`SELECT id FROM communities WHERE source_course_id = ${course.id}`;
    createdCommunityIds.push(row.id);
  });
});

describe("generateAndMaintainWorkplaceCommunities — claimed practice + ≥2 affiliations", () => {
  it("creates a workplace community once the threshold is met, and deactivates it once it drops below", async () => {
    const owner = await createVerifiedTherapist();
    const staff = await createVerifiedTherapist();

    const [practice] = await client<{ id: string }[]>`
      INSERT INTO practices (name, type, created_by_user_id, claim_status)
      VALUES (${"Workplace Test Clinic " + crypto.randomUUID()}, 'clinic', ${owner}, 'claimed') RETURNING id`;
    createdPracticeIds.push(practice.id);

    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by)
      VALUES (${practice.id}, ${owner}, 'owner', 'owns', 'accepted', 'self')`;
    const [staffAffiliation] = await client<{ id: string }[]>`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by)
      VALUES (${practice.id}, ${staff}, 'staff', 'works_at', 'accepted', 'self') RETURNING id`;

    const first = await generateAndMaintainWorkplaceCommunities(db);
    expect(first.created).toBeGreaterThanOrEqual(1);
    const [community] = await client<{ id: string; status: string }[]>`
      SELECT id, status FROM communities WHERE source_practice_id = ${practice.id}`;
    expect(community).toBeDefined();
    expect(community.status).toBe("active");
    createdCommunityIds.push(community.id);

    // Drop below the 2-affiliation threshold.
    await client`UPDATE practice_users SET ended_at = now() WHERE id = ${staffAffiliation.id}`;

    const second = await generateAndMaintainWorkplaceCommunities(db);
    expect(second.deactivated).toBeGreaterThanOrEqual(1);
    const [after] = await client<{ status: string }[]>`SELECT status FROM communities WHERE id = ${community.id}`;
    expect(after.status).toBe("closed");
  });
});
