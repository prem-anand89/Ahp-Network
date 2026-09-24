// Round 2 step 6 (plan decisions 1 & 2) — runs against a real local
// Postgres, never mocks (BUILD_SEQUENCE.md Phase 0's test-stack
// convention).

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  createCommunityFromProposalTx,
  getCityPledgeProgress,
  getCommunityProposalsAtThreshold,
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
const unlockedCitiesToClean: string[] = [];

afterEach(async () => {
  let city: string | undefined;
  while ((city = unlockedCitiesToClean.pop()) !== undefined) {
    await client`DELETE FROM unlocked_cities WHERE city = ${city}`;
  }
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
  let adminUserId: string | undefined;
  while ((adminUserId = createdAdminUserIds.pop()) !== undefined) {
    await client`DELETE FROM admin_users WHERE id = ${adminUserId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM pledges WHERE user_id = ${userId}`;
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

describe("pledgeForCityTx", () => {
  it("counts a pledge and moves a draft profile to waitlisted", async () => {
    const userId = await createTherapist("draft");
    const { pledgeCount } = await pledgeForCityTx(db, userId, "Bengaluru");
    expect(pledgeCount).toBeGreaterThanOrEqual(1);

    const [row] = await client`SELECT profile_status FROM users WHERE id = ${userId}`;
    expect(row.profile_status).toBe("waitlisted");
  });

  it("never demotes an already-active profile", async () => {
    const userId = await createTherapist("active");
    await pledgeForCityTx(db, userId, "Mumbai");

    const [row] = await client`SELECT profile_status FROM users WHERE id = ${userId}`;
    expect(row.profile_status).toBe("active");
  });

  it("re-pledging the same city is a no-op, not a second row", async () => {
    const userId = await createTherapist("draft");
    await pledgeForCityTx(db, userId, "Pune");
    const { pledgeCount } = await pledgeForCityTx(db, userId, "Pune");

    const [{ rows }] = await client`SELECT count(*)::int AS rows FROM pledges WHERE user_id = ${userId} AND target_city = 'Pune'`;
    expect(rows).toBe(1);
    expect(pledgeCount).toBeGreaterThanOrEqual(1);
  });

  it("refuses a city not on the curated pledge list", async () => {
    const userId = await createTherapist("draft");
    await expect(pledgeForCityTx(db, userId, "Test-City-Nowhere")).rejects.toThrow();
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

describe("unlockCityTx — decision 1's two prerequisites", () => {
  it("refuses to unlock a city with no curated areas tree and no statutory council", async () => {
    const admin = await createAdmin();
    await expect(unlockCityTx(db, admin, "Kochi")).rejects.toThrow(/areas tree/);
  });

  it("refuses to unlock a city with an areas tree but no statutory council", async () => {
    const admin = await createAdmin();
    const [cityRow] = await client`
      INSERT INTO areas (name, slug, area_level, curation_status)
      VALUES (${"Ahmedabad"}, ${"pledge-test-ahmedabad-" + crypto.randomUUID()}, 'city', 'approved')
      RETURNING id`;
    createdAreaIds.push(cityRow.id);
    const [zoneRow] = await client`
      INSERT INTO areas (name, slug, area_level, parent_id, curation_status)
      VALUES (${"Test Zone " + crypto.randomUUID()}, ${"pledge-test-zone-" + crypto.randomUUID()}, 'zone', ${cityRow.id}, 'approved')
      RETURNING id`;
    createdAreaIds.push(zoneRow.id);

    await expect(unlockCityTx(db, admin, "Ahmedabad")).rejects.toThrow(/statutory council/);
  });

  it("unlocks once both prerequisites exist, and getCityPledgeProgress reflects it", async () => {
    const admin = await createAdmin();
    const pledger = await createTherapist("draft");
    await pledgeForCityTx(db, pledger, "Kolkata");

    const [cityRow] = await client`
      INSERT INTO areas (name, slug, area_level, curation_status)
      VALUES (${"Kolkata"}, ${"pledge-test-kolkata-" + crypto.randomUUID()}, 'city', 'approved')
      RETURNING id`;
    createdAreaIds.push(cityRow.id);
    const [zoneRow] = await client`
      INSERT INTO areas (name, slug, area_level, parent_id, curation_status)
      VALUES (${"Test Zone " + crypto.randomUUID()}, ${"pledge-test-zone-" + crypto.randomUUID()}, 'zone', ${cityRow.id}, 'approved')
      RETURNING id`;
    createdAreaIds.push(zoneRow.id);
    const [councilRow] = await client`
      INSERT INTO master_councils (name, council_type, state, curation_status)
      VALUES (${"Test West Bengal Council " + crypto.randomUUID()}, 'statutory_registration', 'West Bengal', 'approved')
      RETURNING id`;
    createdCouncilIds.push(councilRow.id);

    const before = await getCityPledgeProgress(db);
    const kolkataBefore = before.find((c) => c.city === "Kolkata");
    expect(kolkataBefore?.hasAreaTree).toBe(true);
    expect(kolkataBefore?.hasStatutoryCouncil).toBe(true);

    await unlockCityTx(db, admin, "Kolkata");
    unlockedCitiesToClean.push("Kolkata");

    const after = await getCityPledgeProgress(db);
    expect(after.find((c) => c.city === "Kolkata")).toBeUndefined();
  });
});

describe("PLEDGE_THRESHOLD", () => {
  it("is a positive number shared by both targets", () => {
    expect(PLEDGE_THRESHOLD).toBeGreaterThan(0);
  });
});
