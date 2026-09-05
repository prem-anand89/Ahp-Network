// §8E3 (Phase 8 narrow slice) — runs against a real local Postgres, never
// mocks. Uses the real seeded founding-cohort community row (Phase 8
// migration) rather than creating a duplicate one.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  createCommunityPostTx,
  FOUNDING_COMMUNITY_SLUG,
  getFoundingCommunity,
  listCommunityPosts,
  recordPostViewTx,
  togglePostLikeTx,
} from "./communities";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdPostIds: string[] = [];

afterEach(async () => {
  let postId: string | undefined;
  while ((postId = createdPostIds.pop()) !== undefined) {
    await client`DELETE FROM community_post_likes WHERE post_id = ${postId}`;
    await client`DELETE FROM community_post_views WHERE post_id = ${postId}`;
    await client`DELETE FROM community_posts WHERE id = ${postId}`;
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
    });
    createdPostIds.push(postId);

    await recordPostViewTx(db, postId, viewer);
    await recordPostViewTx(db, postId, viewer);

    const rows = await client`SELECT * FROM community_post_views WHERE post_id = ${postId}`;
    expect(rows).toHaveLength(1);
  });
});
