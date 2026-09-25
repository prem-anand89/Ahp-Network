// Round 2 step 6 (plan decisions 1 & 2), rewritten for Round 3 step E —
// runs against a real local Postgres, never mocks (BUILD_SEQUENCE.md
// Phase 0's test-stack convention).

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  createCommunityFromProposalTx,
  getCityPledgeProgress,
  getCityProgress,
  getCommunityProposalsAtThreshold,
  isCityUnlocked,
  pledgeForCityTx,
  pledgeForCommunityTx,
  proposeCommunityTx,
  unlockCityTx,
  PLEDGE_THRESHOLD,
} from "./pledges";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdAreaIds: string[] = [];
const createdProposalIds: string[] = [];
const createdCommunityIds: string[] = [];
const createdAdminUserIds: string[] = [];
const createdCouncilIds: string[] = [];

afterEach(async () => {
  let communityId: string | undefined;
  while ((communityId = createdCommunityIds.pop()) !== undefined) {
    await client`DELETE FROM community_members WHERE community_id = ${communityId}`;
    await client`DELETE FROM communities WHERE id = ${communityId}`;
  }
  let proposalId: string | undefined;
  while ((proposalId = createdProposalIds.pop()) !== undefined) {
    await client`DELETE FROM pledges WHERE target_community_proposal_id = ${proposalId}`;
    await client`DELETE FROM community_proposals WHERE id = ${proposalId}`;
  }
  // Cleared before admin_users (unlocked_cities' FK to it) and before
  // the areaId loop's own area deletes.
  if (createdAreaIds.length > 0) {
    await client`DELETE FROM unlocked_cities WHERE city_area_id = ANY(${createdAreaIds})`;
    await client`DELETE FROM pledges WHERE target_city_area_id = ANY(${createdAreaIds})`;
  }
  let adminUserId: string | undefined;
  while ((adminUserId = createdAdminUserIds.pop()) !== undefined) {
    await client`DELETE FROM admin_users WHERE id = ${adminUserId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM pledges WHERE user_id = ${userId}`;
    await client`DELETE FROM home_visit_areas WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
  let areaId: string | undefined;
  while ((areaId = createdAreaIds.pop()) !== undefined) {
    await client`DELETE FROM areas WHERE id = ${areaId}`;
  }
  let councilId: string | undefined;
  while ((councilId = createdCouncilIds.pop()) !== undefined) {
    await client`DELETE FROM master_councils WHERE id = ${councilId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createTherapist(profileStatus: "draft" | "active" = "draft"): Promise<string> {
  const email = `pledge-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`
    INSERT INTO users (id, email, account_type, profile_status)
    VALUES (${authUser.id}, ${email}, 'therapist', ${profileStatus})`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function createAdmin(): Promise<string> {
  const userId = await createTherapist("active");
  const [admin] = await client`INSERT INTO admin_users (user_id) VALUES (${userId}) RETURNING id`;
  createdAdminUserIds.push(admin.id);
  return admin.id;
}

async function createCity(name?: string): Promise<string> {
  const [city] = await client`
    INSERT INTO areas (name, slug, area_level, curation_status)
    VALUES (${name ?? "Test City " + crypto.randomUUID()}, ${"pledge-test-city-" + crypto.randomUUID()}, 'city', 'approved')
    RETURNING id`;
  createdAreaIds.push(city.id);
  await client`UPDATE areas SET city_area_id = ${city.id} WHERE id = ${city.id}`;
  return city.id as string;
}

async function createLocalityIn(cityAreaId: string): Promise<string> {
  const [locality] = await client`
    INSERT INTO areas (name, slug, area_level, parent_id, city_area_id, curation_status)
    VALUES (${"Test Locality " + crypto.randomUUID()}, ${"pledge-test-locality-" + crypto.randomUUID()}, 'locality', ${cityAreaId}, ${cityAreaId}, 'approved')
    RETURNING id`;
  createdAreaIds.push(locality.id);
  return locality.id as string;
}

async function createTherapistBasedIn(cityAreaId: string): Promise<string> {
  const localityId = await createLocalityIn(cityAreaId);
  const userId = await createTherapist("active");
  await client`INSERT INTO home_visit_areas (user_id, area_id, is_primary) VALUES (${userId}, ${localityId}, true)`;
  return userId;
}

describe("pledgeForCityTx", () => {
  it("counts a pledge without touching profile_status (Round 3 — no waitlist side effect)", async () => {
    const cityId = await createCity();
    const userId = await createTherapist("draft");
    const { pledgeCount } = await pledgeForCityTx(db, userId, cityId);
    expect(pledgeCount).toBeGreaterThanOrEqual(1);

    const [row] = await client`SELECT profile_status FROM users WHERE id = ${userId}`;
    expect(row.profile_status).toBe("draft");
  });

  it("re-pledging the same city is a no-op, not a second row", async () => {
    const cityId = await createCity();
    const userId = await createTherapist("draft");
    await pledgeForCityTx(db, userId, cityId);
    const { pledgeCount } = await pledgeForCityTx(db, userId, cityId);

    const [{ rows }] = await client`SELECT count(*)::int AS rows FROM pledges WHERE user_id = ${userId} AND target_city_area_id = ${cityId}`;
    expect(rows).toBe(1);
    expect(pledgeCount).toBeGreaterThanOrEqual(1);
  });

  it("refuses a non-city area (a locality)", async () => {
    const cityId = await createCity();
    const localityId = await createLocalityIn(cityId);
    const userId = await createTherapist("draft");
    await expect(pledgeForCityTx(db, userId, localityId)).rejects.toThrow();
  });

  it("refuses a garbage id", async () => {
    const userId = await createTherapist("draft");
    await expect(pledgeForCityTx(db, userId, crypto.randomUUID())).rejects.toThrow();
  });

  it("refuses a city still pending_review", async () => {
    const [city] = await client`
      INSERT INTO areas (name, slug, area_level, curation_status)
      VALUES (${"Pending City " + crypto.randomUUID()}, ${"pledge-test-pending-" + crypto.randomUUID()}, 'city', 'pending_review')
      RETURNING id`;
    createdAreaIds.push(city.id);
    const userId = await createTherapist("draft");
    await expect(pledgeForCityTx(db, userId, city.id)).rejects.toThrow();
  });
});

describe("getCityPledgeProgress / getCityProgress — Round 3 step E counting rule", () => {
  it("counts an active therapist based in the city, with no explicit pledge at all", async () => {
    const cityId = await createCity();
    await createTherapistBasedIn(cityId);

    const { pledgeCount } = await getCityProgress(db, cityId);
    expect(pledgeCount).toBe(1);
  });

  it("counts a pledger from elsewhere, in addition to based-there therapists", async () => {
    const cityId = await createCity();
    await createTherapistBasedIn(cityId);
    const pledger = await createTherapist("draft");
    await pledgeForCityTx(db, pledger, cityId);

    const { pledgeCount } = await getCityProgress(db, cityId);
    expect(pledgeCount).toBe(2);
  });

  it("does not double-count someone who is both based there and also pledged", async () => {
    const cityId = await createCity();
    const userId = await createTherapistBasedIn(cityId);
    await pledgeForCityTx(db, userId, cityId);

    const { pledgeCount } = await getCityProgress(db, cityId);
    expect(pledgeCount).toBe(1);
  });

  it("does not count a draft (not yet active) therapist's base locality", async () => {
    const cityId = await createCity();
    const localityId = await createLocalityIn(cityId);
    const userId = await createTherapist("draft");
    await client`INSERT INTO home_visit_areas (user_id, area_id, is_primary) VALUES (${userId}, ${localityId}, true)`;

    const { pledgeCount } = await getCityProgress(db, cityId);
    expect(pledgeCount).toBe(0);
  });

  it("getCityPledgeProgress excludes an already-unlocked city", async () => {
    const cityId = await createCity();
    const pledger = await createTherapist("draft");
    await pledgeForCityTx(db, pledger, cityId);
    const admin = await createAdmin();
    await unlockCityTx(db, admin, cityId);

    const progress = await getCityPledgeProgress(db);
    expect(progress.find((c) => c.cityAreaId === cityId)).toBeUndefined();
  });

  it("getCityPledgeProgress includes a candidate city with its name and prerequisite checklist", async () => {
    const cityId = await createCity("Progress Test City");
    await createLocalityIn(cityId); // gives it a real area tree
    const pledger = await createTherapist("draft");
    await pledgeForCityTx(db, pledger, cityId);

    const progress = await getCityPledgeProgress(db);
    const entry = progress.find((c) => c.cityAreaId === cityId);
    expect(entry?.cityName).toBe("Progress Test City");
    expect(entry?.pledgeCount).toBe(1);
    expect(entry?.hasAreaTree).toBe(true);
  });
});

describe("proposeCommunityTx / pledgeForCommunityTx", () => {
  it("proposing counts as the proposer's own pledge", async () => {
    const userId = await createTherapist("active");
    const proposal = await proposeCommunityTx(db, userId, "Pediatric Rehab Circle", "For pediatric specialists");
    createdProposalIds.push(proposal.id);
    expect(proposal.pledgeCount).toBe(1);
  });

  it("a second person pledging increases the count", async () => {
    const proposer = await createTherapist("active");
    const pledger = await createTherapist("active");
    const proposal = await proposeCommunityTx(db, proposer, "Vestibular Interest Group", undefined);
    createdProposalIds.push(proposal.id);

    const { pledgeCount } = await pledgeForCommunityTx(db, pledger, proposal.id);
    expect(pledgeCount).toBe(2);
  });

  it("refuses a pledge toward an already-created proposal", async () => {
    const proposer = await createTherapist("active");
    const admin = await createAdmin();
    const proposal = await proposeCommunityTx(db, proposer, "Already Created Group", undefined);
    createdProposalIds.push(proposal.id);
    const { communityId } = await createCommunityFromProposalTx(db, admin, proposal.id);
    createdCommunityIds.push(communityId);

    const latecomer = await createTherapist("active");
    await expect(pledgeForCommunityTx(db, latecomer, proposal.id)).rejects.toThrow();
  });
});

describe("createCommunityFromProposalTx", () => {
  it("creates the community and adds every pledger as a member", async () => {
    const proposer = await createTherapist("active");
    const pledgerA = await createTherapist("active");
    const pledgerB = await createTherapist("active");
    const admin = await createAdmin();

    const proposal = await proposeCommunityTx(db, proposer, "Sports Rehab Hyderabad", "Sports injury specialists");
    createdProposalIds.push(proposal.id);
    await pledgeForCommunityTx(db, pledgerA, proposal.id);
    await pledgeForCommunityTx(db, pledgerB, proposal.id);

    const { communityId } = await createCommunityFromProposalTx(db, admin, proposal.id);
    createdCommunityIds.push(communityId);

    const [community] = await client`SELECT origin, type, source_proposal_id FROM communities WHERE id = ${communityId}`;
    expect(community.origin).toBe("user_pledged");
    expect(community.source_proposal_id).toBe(proposal.id);

    const members = await client`SELECT user_id FROM community_members WHERE community_id = ${communityId}`;
    const memberIds = members.map((m) => m.user_id);
    expect(memberIds).toContain(proposer);
    expect(memberIds).toContain(pledgerA);
    expect(memberIds).toContain(pledgerB);

    const [updatedProposal] = await client`SELECT status, created_community_id FROM community_proposals WHERE id = ${proposal.id}`;
    expect(updatedProposal.status).toBe("created");
    expect(updatedProposal.created_community_id).toBe(communityId);
  });

  it("refuses to create twice from the same proposal", async () => {
    const proposer = await createTherapist("active");
    const admin = await createAdmin();
    const proposal = await proposeCommunityTx(db, proposer, "Double Create Group", undefined);
    createdProposalIds.push(proposal.id);

    const { communityId } = await createCommunityFromProposalTx(db, admin, proposal.id);
    createdCommunityIds.push(communityId);

    await expect(createCommunityFromProposalTx(db, admin, proposal.id)).rejects.toThrow();
  });

  it("two admins creating from the same proposal concurrently produce exactly one community, never two", async () => {
    const proposer = await createTherapist("active");
    const adminA = await createAdmin();
    const adminB = await createAdmin();
    const proposal = await proposeCommunityTx(db, proposer, "Concurrent Create Group " + crypto.randomUUID(), undefined);
    createdProposalIds.push(proposal.id);

    const results = await Promise.allSettled([
      createCommunityFromProposalTx(db, adminA, proposal.id),
      createCommunityFromProposalTx(db, adminB, proposal.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const rows = await client`SELECT id FROM communities WHERE source_proposal_id = ${proposal.id}`;
    expect(rows).toHaveLength(1);
    createdCommunityIds.push(rows[0].id);
  });
});

describe("getCommunityProposalsAtThreshold", () => {
  it("excludes an open proposal below the threshold", async () => {
    const proposer = await createTherapist("active");
    const proposal = await proposeCommunityTx(db, proposer, "Below Threshold Group", undefined);
    createdProposalIds.push(proposal.id);

    const atThreshold = await getCommunityProposalsAtThreshold(db);
    expect(atThreshold.map((p) => p.id)).not.toContain(proposal.id);
  });
});

describe("unlockCityTx — Round 3 step E: prerequisites are informational, not blocking", () => {
  it("unlocks a city with neither prerequisite met — no throw, prereqs are checklist-only now", async () => {
    const admin = await createAdmin();
    const cityId = await createCity();
    await unlockCityTx(db, admin, cityId);
    expect(await isCityUnlocked(db, cityId)).toBe(true);
  });

  it("still refuses an unknown/garbage city id", async () => {
    const admin = await createAdmin();
    await expect(unlockCityTx(db, admin, crypto.randomUUID())).rejects.toThrow();
  });

  it("getCityPledgeProgress reports both prerequisites once real ones exist", async () => {
    // State created (and pushed for cleanup) BEFORE the city that will
    // reference it as parent_id, so afterEach's LIFO cleanup deletes the
    // city first, then the state — the reverse order would violate
    // areas_parent_id_areas_id_fk.
    const stateName = "Prereq Test State " + crypto.randomUUID();
    const [stateRow] = await client`
      INSERT INTO areas (name, slug, area_level) VALUES (${stateName}, ${"pledge-test-state-" + crypto.randomUUID()}, 'state')
      RETURNING id`;
    createdAreaIds.push(stateRow.id);

    const [cityRow] = await client`
      INSERT INTO areas (name, slug, area_level, parent_id, curation_status)
      VALUES (${"Prereq Test City"}, ${"pledge-test-city-" + crypto.randomUUID()}, 'city', ${stateRow.id}, 'approved')
      RETURNING id`;
    createdAreaIds.push(cityRow.id);
    const cityId = cityRow.id as string;
    await client`UPDATE areas SET city_area_id = ${cityId} WHERE id = ${cityId}`;
    await createLocalityIn(cityId);

    const [councilRow] = await client`
      INSERT INTO master_councils (name, council_type, state, curation_status)
      VALUES (${"Test Prereq Council " + crypto.randomUUID()}, 'statutory_registration', ${stateName}, 'approved')
      RETURNING id`;
    createdCouncilIds.push(councilRow.id);
    const pledger = await createTherapist("draft");
    await pledgeForCityTx(db, pledger, cityId);

    const progress = await getCityPledgeProgress(db);
    const entry = progress.find((c) => c.cityAreaId === cityId);
    expect(entry?.hasAreaTree).toBe(true);
    expect(entry?.hasStatutoryCouncil).toBe(true);
  });

  it("onConflictDoNothing — unlocking twice doesn't throw", async () => {
    const admin = await createAdmin();
    const cityId = await createCity();
    await unlockCityTx(db, admin, cityId);
    await expect(unlockCityTx(db, admin, cityId)).resolves.not.toThrow();
  });
});

describe("isCityUnlocked", () => {
  it("false for a city with no unlocked_cities row", async () => {
    const cityId = await createCity();
    expect(await isCityUnlocked(db, cityId)).toBe(false);
  });

  it("true once unlocked", async () => {
    const admin = await createAdmin();
    const cityId = await createCity();
    await unlockCityTx(db, admin, cityId);
    expect(await isCityUnlocked(db, cityId)).toBe(true);
  });
});

describe("pledges_target_shape CHECK constraint", () => {
  it("rejects a row with neither target set", async () => {
    const userId = await createTherapist("active");
    await expect(client`INSERT INTO pledges (user_id, target_type) VALUES (${userId}, 'city')`).rejects.toThrow();
  });

  it("rejects a row with both targets set", async () => {
    const userId = await createTherapist("active");
    const cityId = await createCity();
    const proposal = await proposeCommunityTx(db, userId, "Constraint Test Group", undefined);
    createdProposalIds.push(proposal.id);
    await expect(
      client`INSERT INTO pledges (user_id, target_type, target_city_area_id, target_community_proposal_id)
             VALUES (${userId}, 'city', ${cityId}, ${proposal.id})`,
    ).rejects.toThrow();
  });
});

describe("PLEDGE_THRESHOLD", () => {
  it("is a positive number shared by both targets", () => {
    expect(PLEDGE_THRESHOLD).toBeGreaterThan(0);
  });
});
