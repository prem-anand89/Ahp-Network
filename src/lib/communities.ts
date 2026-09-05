// §8E3 (Phase 8, narrow slice) — the founding-cohort community only.
// Deliberately does NOT build community_members, community_moderators, or
// auto-generation — that's Phase 9 (BUILD_SEQUENCE.md). The founding-cohort
// community is platform-curated and founder-only-posts at pilot, so every
// post here defaults to 'published' — the pending_review branch for
// unowned (institution/certification) origins doesn't apply to this slice.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { communities, communityPostLikes, communityPostViews, communityPosts } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export const FOUNDING_COMMUNITY_SLUG = "founding-cohort";

export async function getFoundingCommunity(db: Db) {
  const [community] = await db.select().from(communities).where(eq(communities.slug, FOUNDING_COMMUNITY_SLUG));
  if (!community) {
    throw new Error("Founding-cohort community row is missing — check the Phase 8 migration seed");
  }
  return community;
}

export interface CommunityPostWithStats {
  id: string;
  type: "announcement" | "resource" | "event";
  title: string;
  body: string | null;
  url: string | null;
  createdAt: string;
  likeCount: number;
  viewedByMe: boolean;
  likedByMe: boolean;
}

/** Published posts only — never removed/pending_review ones, on this public-to-the-cohort feed. */
export async function listCommunityPosts(
  db: Db,
  communityId: string,
  viewerUserId: string,
): Promise<CommunityPostWithStats[]> {
  const rows = await db
    .select({
      id: communityPosts.id,
      type: communityPosts.type,
      title: communityPosts.title,
      body: communityPosts.body,
      url: communityPosts.url,
      createdAt: communityPosts.createdAt,
      likeCount: sql<number>`(SELECT count(*)::int FROM community_post_likes WHERE post_id = ${communityPosts.id})`,
      likedByMe: sql<boolean>`EXISTS (SELECT 1 FROM community_post_likes WHERE post_id = ${communityPosts.id} AND user_id = ${viewerUserId})`,
      viewedByMe: sql<boolean>`EXISTS (SELECT 1 FROM community_post_views WHERE post_id = ${communityPosts.id} AND user_id = ${viewerUserId})`,
    })
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.communityId, communityId),
        eq(communityPosts.status, "published"),
        isNull(communityPosts.deletedAt),
      ),
    )
    .orderBy(desc(communityPosts.createdAt));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

export interface CreateCommunityPostInput {
  communityId: string;
  postedByUserId: string;
  type: "announcement" | "resource" | "event";
  title: string;
  body?: string;
  url?: string;
}

/**
 * Authorization (who may post at all) is the caller's job via authz.ts's
 * `post_to_community` action — this function only writes the row, always
 * 'published' since the founding-cohort community is owned/founder-
 * moderated (§8E3's table: owned communities default to published).
 */
export async function createCommunityPostTx(db: Db, input: CreateCommunityPostInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(communityPosts)
    .values({
      communityId: input.communityId,
      postedByUserId: input.postedByUserId,
      type: input.type,
      title: input.title,
      body: input.body,
      url: input.url,
      status: "published",
    })
    .returning({ id: communityPosts.id });
  return row;
}

/** Toggle: insert on tap, delete on un-tap — same shape as a single Like everywhere else on the web. */
export async function togglePostLikeTx(db: Db, postId: string, userId: string): Promise<{ liked: boolean }> {
  const [existing] = await db
    .select()
    .from(communityPostLikes)
    .where(and(eq(communityPostLikes.postId, postId), eq(communityPostLikes.userId, userId)));

  if (existing) {
    await db
      .delete(communityPostLikes)
      .where(and(eq(communityPostLikes.postId, postId), eq(communityPostLikes.userId, userId)));
    return { liked: false };
  }

  await db.insert(communityPostLikes).values({ postId, userId }).onConflictDoNothing();
  return { liked: true };
}

/** First view only, same rule as referral_events' referral_viewed. */
export async function recordPostViewTx(db: Db, postId: string, userId: string): Promise<void> {
  await db.insert(communityPostViews).values({ postId, userId }).onConflictDoNothing();
}
