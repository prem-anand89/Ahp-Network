// §8E3 — runs against a real local Postgres, never mocks. Started in
// Phase 8 against just the seeded founding-cohort community row; now also
// covers Phase 9's general communities (join/leave, pending_review
// gating, workplace membership derived live from practice_users).

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  canSubmitToCommunity,
  createCommunity,
  createCommunityPostTx,
  FOUNDING_COMMUNITY_SLUG,
  getFoundingCommunity,
  isCommunityMember,
  isWorkplaceCommunityMember,
  joinCommunityTx,
  leaveCommunityTx,
  listCommunityPosts,
  recordPostViewTx,
  togglePostLikeTx,
} from "./communities";
import { approveModeratorTx, applyForModeratorTx } from "./community-moderators";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdPostIds: string[] = [];
const createdCommunityIds: string[] = [];
const createdPracticeIds: string[] = [];
const createdAdminUserIds: string[] = [];

afterEach(async () => {
  let postId: string | undefined;
  while ((postId = createdPostIds.pop()) !== undefined) {
    await client`DELETE FROM community_post_likes WHERE post_id = ${postId}`;
    await client`DELETE FROM community_post_views WHERE post_id = ${postId}`;
    await client`DELETE FROM community_posts WHERE id = ${postId}`;
  }
  let practiceId: string | undefined;
  while ((practiceId = createdPracticeIds.pop()) !== undefined) {
    await client`DELETE FROM practice_users WHERE practice_id = ${practiceId}`;
    await client`DELETE FROM practices WHERE id = ${practiceId}`;
  }
  let communityId: string | undefined;
  while ((communityId = createdCommunityIds.pop()) !== undefined) {
    await client`DELETE FROM community_moderators WHERE community_id = ${communityId}`;
    await client`DELETE FROM community_members WHERE community_id = ${communityId}`;
    await client`DELETE FROM communities WHERE id = ${communityId}`;
  }
  // admin_users rows must outlive the community_moderators rows that
  // reference them (reviewed_by_admin_id/revoked_by_admin_id), so this
  // runs after the community cleanup above and before the users cleanup
  // below (admin_users.user_id references users).
  let adminUserId: string | undefined;
  while ((adminUserId = createdAdminUserIds.pop()) !== undefined) {
    await client`DELETE FROM admin_users WHERE id = ${adminUserId}`;
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

async function createUser(): Promise<string> {
  const email = `community-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("getFoundingCommunity", () => {
  it("finds the seeded founding-cohort row", async () => {
    const community = await getFoundingCommunity(db);
    expect(community.slug).toBe(FOUNDING_COMMUNITY_SLUG);
    expect(community.origin).toBe("platform_curated");
  });
});

describe("createCommunityPostTx / listCommunityPosts / likes / views", () => {
  it("a founder-posted announcement is immediately published and visible", async () => {
    const community = await getFoundingCommunity(db);
    const founder = await createUser();
    const viewer = await createUser();

    const { id: postId } = await createCommunityPostTx(db, {
      communityId: community.id,
      postedByUserId: founder,
      type: "announcement",
      title: "Welcome to the founding cohort",
      body: "Glad to have you here.",
      posterIsAdmin: true,
    });
    createdPostIds.push(postId);

    const posts = await listCommunityPosts(db, community.id, viewer);
    const found = posts.find((p) => p.id === postId);
    expect(found).toBeDefined();
    expect(found?.likeCount).toBe(0);
    expect(found?.likedByMe).toBe(false);
  });

  it("toggles a like on and off", async () => {
    const community = await getFoundingCommunity(db);
    const founder = await createUser();
    const liker = await createUser();
    const { id: postId } = await createCommunityPostTx(db, {
      communityId: community.id,
      postedByUserId: founder,
      type: "resource",
      title: "Free CE webinar",
      url: "https://example.com",
      posterIsAdmin: true,
    });
    createdPostIds.push(postId);

    const first = await togglePostLikeTx(db, postId, liker);
    expect(first.liked).toBe(true);

    const posts = await listCommunityPosts(db, community.id, liker);
    expect(posts.find((p) => p.id === postId)?.likeCount).toBe(1);

    const second = await togglePostLikeTx(db, postId, liker);
    expect(second.liked).toBe(false);
  });

  it("records a first view only, idempotently", async () => {
    const community = await getFoundingCommunity(db);
    const founder = await createUser();
    const viewer = await createUser();
    const { id: postId } = await createCommunityPostTx(db, {
      communityId: community.id,
      postedByUserId: founder,
      type: "event",
      title: "Mulligan refresher",
      body: "14 Dec, Hyderabad",
      posterIsAdmin: true,
    });
    createdPostIds.push(postId);

    await recordPostViewTx(db, postId, viewer);
    await recordPostViewTx(db, postId, viewer);

    const rows = await client`SELECT * FROM community_post_views WHERE post_id = ${postId}`;
    expect(rows).toHaveLength(1);
  });
});

describe("Phase 9 — join/leave a platform-curated community", () => {
  it("joining and leaving is idempotent and reflected in membership", async () => {
    const user = await createUser();
    const community = await createCommunity(db, { name: `Test Community ${crypto.randomUUID()}`, slug: `test-${crypto.randomUUID()}` });
    createdCommunityIds.push(community.id);

    expect(await isCommunityMember(db, community.id, user)).toBe(false);
    await joinCommunityTx(db, community.id, user);
    await joinCommunityTx(db, community.id, user); // idempotent
    expect(await isCommunityMember(db, community.id, user)).toBe(true);

    await leaveCommunityTx(db, community.id, user);
    expect(await isCommunityMember(db, community.id, user)).toBe(false);
  });
});

describe("Phase 9 — institution/certification pending_review gate (§8E3)", () => {
  async function seedInstitutionCommunity() {
    const [institution] = await client<{ id: string }[]>`
      INSERT INTO master_institutions (name, normalized_name) VALUES (${"Test Institute " + crypto.randomUUID()}, 'test-institute') RETURNING id`;
    const [community] = await client<{ id: string }[]>`
      INSERT INTO communities (name, slug, origin, source_institution_id)
      VALUES (${"Test Institute Alumni"}, ${`institute-${crypto.randomUUID()}`}, 'auto_generated_institution', ${institution.id})
      RETURNING id`;
    createdCommunityIds.push(community.id);
    return community.id;
  }

  it("a non-member cannot submit at all", async () => {
    const communityId = await seedInstitutionCommunity();
    const outsider = await createUser();
    expect(await canSubmitToCommunity(db, communityId, outsider, false)).toBe(false);
  });

  it("a plain member's post enters pending_review, not published", async () => {
    const communityId = await seedInstitutionCommunity();
    const member = await createUser();
    await joinCommunityTx(db, communityId, member);

    expect(await canSubmitToCommunity(db, communityId, member, false)).toBe(true);
    const { id: postId, status } = await createCommunityPostTx(db, {
      communityId,
      postedByUserId: member,
      type: "resource",
      title: "A resource",
      posterIsAdmin: false,
    });
    createdPostIds.push(postId);
    expect(status).toBe("pending_review");
  });

  it("an approved moderator's post publishes immediately", async () => {
    const communityId = await seedInstitutionCommunity();
    const moderator = await createUser();
    await joinCommunityTx(db, communityId, moderator);
    await applyForModeratorTx(db, communityId, moderator);
    const [{ id: modRowId }] = await client<{ id: string }[]>`
      SELECT id FROM community_moderators WHERE community_id = ${communityId} AND user_id = ${moderator}`;

    const admin = await createUser();
    const [adminUserRow] = await client<{ id: string }[]>`
      INSERT INTO admin_users (user_id) VALUES (${admin}) RETURNING id`;
    createdAdminUserIds.push(adminUserRow.id);
    await approveModeratorTx(db, modRowId, adminUserRow.id);

    const { id: postId, status } = await createCommunityPostTx(db, {
      communityId,
      postedByUserId: moderator,
      type: "resource",
      title: "A resource",
      posterIsAdmin: false,
    });
    createdPostIds.push(postId);
    expect(status).toBe("published");
  });

  it("an admin's post publishes immediately even without being a member", async () => {
    const communityId = await seedInstitutionCommunity();
    const admin = await createUser();

    const { id: postId, status } = await createCommunityPostTx(db, {
      communityId,
      postedByUserId: admin,
      type: "resource",
      title: "A resource",
      posterIsAdmin: true,
    });
    createdPostIds.push(postId);
    expect(status).toBe("published");
  });
});

describe("Phase 9 — workplace community membership derives live from practice_users (§8E3)", () => {
  it("membership changes when an affiliation's ended_at is set — no separate row to update", async () => {
    const owner = await createUser();
    const staff = await createUser();

    const [practice] = await client<{ id: string }[]>`
      INSERT INTO practices (name, type, created_by_user_id, claim_status)
      VALUES ('Test Clinic', 'clinic', ${owner}, 'claimed') RETURNING id`;
    createdPracticeIds.push(practice.id);

    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by)
      VALUES (${practice.id}, ${owner}, 'owner', 'owns', 'accepted', 'self')`;
    const [staffAffiliation] = await client<{ id: string }[]>`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, consent_status, asserted_by)
      VALUES (${practice.id}, ${staff}, 'staff', 'works_at', 'accepted', 'self') RETURNING id`;

    const [community] = await client<{ id: string }[]>`
      INSERT INTO communities (name, slug, origin, source_practice_id)
      VALUES ('Test Clinic Workspace', ${`clinic-${crypto.randomUUID()}`}, 'auto_generated_practice', ${practice.id})
      RETURNING id`;
    createdCommunityIds.push(community.id);

    expect(await isWorkplaceCommunityMember(db, community.id, staff)).toBe(true);

    await client`UPDATE practice_users SET ended_at = now() WHERE id = ${staffAffiliation.id}`;

    expect(await isWorkplaceCommunityMember(db, community.id, staff)).toBe(false);
    // The owner's own affiliation is untouched — still a member.
    expect(await isWorkplaceCommunityMember(db, community.id, owner)).toBe(true);
  });
});
