// §8E3 — Communities. Started in Phase 8 as a founding-cohort-only slice;
// this file now covers all four origin types (platform_curated,
// auto_generated_institution, auto_generated_certification,
// auto_generated_practice, user_created — see communities.origin).
//
// Membership: platform-curated/institution/certification/user-created
// communities use community_members (opt-in, one-tap join, never
// auto-enrolled). Workplace (auto_generated_practice) communities never
// use it — see practice_community_members in drizzle/0027, queried by
// listWorkplaceCommunityMemberIds below.
//
// Posting status: owned origins (platform_curated, auto_generated_practice)
// always publish immediately, since the poster already cleared a stronger
// gate (admin tier, or a practice access role) to reach createCommunityPostTx
// at all. Unowned origins (institution, certification, user_created)
// publish immediately only for an approved moderator or an admin —
// resolveInitialPostStatus below is the one place that decision is made.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  communities,
  communityMembers,
  communityPostLikes,
  communityPostViews,
  communityPosts,
  practiceUsers,
  specializationTypeEnum,
} from "@/db/schema";
import type { getDb } from "@/db/db";
import { isApprovedModerator } from "./community-moderators";

type Db = Awaited<ReturnType<typeof getDb>>;
type SpecializationType = (typeof specializationTypeEnum.enumValues)[number];

export const FOUNDING_COMMUNITY_SLUG = "founding-cohort";

export type CommunityOrigin =
  | "platform_curated"
  | "auto_generated_institution"
  | "auto_generated_certification"
  | "auto_generated_practice"
  | "user_created";

/** Origins with an accountable owner (an admin, or the practice) — posts
 * always publish immediately. Institution/certification/user-created
 * communities have no single owner, so §8E3 routes their posts through
 * moderation unless the poster already holds standing. */
const OWNED_ORIGINS: CommunityOrigin[] = ["platform_curated", "auto_generated_practice"];

export async function getFoundingCommunity(db: Db) {
  const [community] = await db.select().from(communities).where(eq(communities.slug, FOUNDING_COMMUNITY_SLUG));
  if (!community) {
    throw new Error("Founding-cohort community row is missing — check the Phase 8 migration seed");
  }
  return community;
}

export interface CommunitySummary {
  id: string;
  name: string;
  slug: string;
  origin: string;
  areaId: string | null;
  specialization: string | null;
  createdAt: Date;
  isMember: boolean;
}

/** Active, joinable communities — platform-curated, auto-generated, and
 * user-created, excluding workplace communities (§8E3: those have no
 * "join" action, membership is computed from practice_users) and the
 * founding-cohort community (it has its own dedicated /app/community
 * page and every pilot member is already in it by construction). */
export async function listJoinableCommunities(db: Db, viewerUserId: string): Promise<CommunitySummary[]> {
  const rows = await db
    .select({
      id: communities.id,
      name: communities.name,
      slug: communities.slug,
      origin: communities.origin,
      areaId: communities.areaId,
      specialization: communities.specialization,
      createdAt: communities.createdAt,
      isMember: sql<boolean>`EXISTS (SELECT 1 FROM community_members WHERE community_id = ${communities.id} AND user_id = ${viewerUserId})`,
    })
    .from(communities)
    .where(
      and(
        eq(communities.status, "active"),
        sql`${communities.origin} != 'auto_generated_practice'`,
        sql`${communities.slug} != ${FOUNDING_COMMUNITY_SLUG}`,
        isNull(communities.deletedAt),
      ),
    )
    .orderBy(communities.createdAt);
  return rows;
}

export interface CreateCommunityInput {
  name: string;
  slug: string;
  areaId?: string;
  specialization?: SpecializationType;
}

/** Admin-created platform-curated communities (§8E3's "Admin, freely" row,
 * [H3] no density gate — in pilot scope). Authorization is the caller's
 * job (authz's create_community action); this only writes the row. */
export async function createCommunity(db: Db, input: CreateCommunityInput): Promise<{ id: string }> {
  const name = input.name.trim();
  const slug = input.slug.trim();
  if (!name) throw new Error("Community name is required");
  if (!slug) throw new Error("Community slug is required");

  const [row] = await db
    .insert(communities)
    .values({
      name,
      slug,
      areaId: input.areaId,
      specialization: input.specialization,
      type: "platform_official",
      status: "active",
      origin: "platform_curated",
    })
    .returning({ id: communities.id });
  return row;
}

export async function isCommunityMember(db: Db, communityId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ communityId: communityMembers.communityId })
    .from(communityMembers)
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
  return Boolean(row);
}

/** One-tap opt-in join — never auto-enrolled (§8E3). Idempotent. */
export async function joinCommunityTx(db: Db, communityId: string, userId: string): Promise<void> {
  await db.insert(communityMembers).values({ communityId, userId }).onConflictDoNothing();
}

export async function leaveCommunityTx(db: Db, communityId: string, userId: string): Promise<void> {
  await db
    .delete(communityMembers)
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
}

export interface CommunityPostWithStats {
  id: string;
  type: "announcement" | "resource" | "event";
  title: string;
  body: string | null;
  url: string | null;
  status: "pending_review" | "published" | "removed";
  createdAt: string;
  likeCount: number;
  viewedByMe: boolean;
  likedByMe: boolean;
}

/** Published posts, plus the viewer's own still-pending posts (so a
 * member who submitted something awaiting review can see it sitting
 * there rather than it silently vanishing) — never other people's
 * pending or removed posts. */
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
      status: communityPosts.status,
      createdAt: communityPosts.createdAt,
      likeCount: sql<number>`(SELECT count(*)::int FROM community_post_likes WHERE post_id = ${communityPosts.id})`,
      likedByMe: sql<boolean>`EXISTS (SELECT 1 FROM community_post_likes WHERE post_id = ${communityPosts.id} AND user_id = ${viewerUserId})`,
      viewedByMe: sql<boolean>`EXISTS (SELECT 1 FROM community_post_views WHERE post_id = ${communityPosts.id} AND user_id = ${viewerUserId})`,
    })
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.communityId, communityId),
        sql`(${communityPosts.status} = 'published' OR (${communityPosts.status} = 'pending_review' AND ${communityPosts.postedByUserId} = ${viewerUserId}))`,
        isNull(communityPosts.deletedAt),
      ),
    )
    .orderBy(sql`${communityPosts.createdAt} DESC`);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** §8E3's table: owned origins (platform_curated, auto_generated_practice)
 * always publish; unowned origins publish only for an approved moderator
 * or an admin, otherwise pending_review. */
export async function resolveInitialPostStatus(
  db: Db,
  origin: string,
  communityId: string,
  posterUserId: string,
  posterIsAdmin: boolean,
): Promise<"published" | "pending_review"> {
  if (OWNED_ORIGINS.includes(origin as CommunityOrigin)) return "published";
  if (posterIsAdmin) return "published";
  const moderator = await isApprovedModerator(db, communityId, posterUserId);
  return moderator ? "published" : "pending_review";
}

/**
 * Whether posterUserId may submit a post to this community AT ALL —
 * separate from resolveInitialPostStatus, which only decides the
 * resulting status once submission is already allowed. Per §8E3's table:
 * platform-curated is admin-only ("Admin, freely"); institution/
 * certification/user-created require community membership (or, for
 * user-created, being the creator); workplace requires an active practice
 * access role at the source practice.
 */
export async function canSubmitToCommunity(
  db: Db,
  communityId: string,
  posterUserId: string,
  posterIsAdmin: boolean,
): Promise<boolean> {
  const community = await getCommunityById(db, communityId);
  if (!community) return false;

  switch (community.origin) {
    case "platform_curated":
      return posterIsAdmin;
    case "auto_generated_practice": {
      if (!community.sourcePracticeId) return false;
      const [row] = await db
        .select({ id: practiceUsers.id })
        .from(practiceUsers)
        .where(
          and(
            eq(practiceUsers.practiceId, community.sourcePracticeId),
            eq(practiceUsers.userId, posterUserId),
            inArray(practiceUsers.accessRole, ["owner", "manager"]),
            eq(practiceUsers.consentStatus, "accepted"),
            isNull(practiceUsers.endedAt),
            isNull(practiceUsers.deletedAt),
          ),
        );
      return Boolean(row);
    }
    case "user_created":
      return posterIsAdmin || community.createdByUserId === posterUserId;
    case "auto_generated_institution":
    case "auto_generated_certification":
      return posterIsAdmin || (await isCommunityMember(db, communityId, posterUserId));
    default:
      return false;
  }
}

export interface CreateCommunityPostInput {
  communityId: string;
  postedByUserId: string;
  type: "announcement" | "resource" | "event";
  title: string;
  body?: string;
  url?: string;
  posterIsAdmin: boolean;
}

/**
 * Authorization (whether the poster may submit to this community at all)
 * is the caller's job — this only decides the resulting status (§8E3's
 * table) and writes the row.
 */
export async function createCommunityPostTx(
  db: Db,
  input: CreateCommunityPostInput,
): Promise<{ id: string; status: "published" | "pending_review" }> {
  const [community] = await db
    .select({ origin: communities.origin })
    .from(communities)
    .where(eq(communities.id, input.communityId));
  if (!community) throw new Error("Community not found");

  const status = await resolveInitialPostStatus(
    db,
    community.origin,
    input.communityId,
    input.postedByUserId,
    input.posterIsAdmin,
  );

  const [row] = await db
    .insert(communityPosts)
    .values({
      communityId: input.communityId,
      postedByUserId: input.postedByUserId,
      type: input.type,
      title: input.title,
      body: input.body,
      url: input.url,
      status,
    })
    .returning({ id: communityPosts.id });
  return { id: row.id, status };
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

/** Workplace communities never store membership — this reads the live
 * practice_community_members view (drizzle/0027) instead. */
export async function listWorkplaceCommunityMemberIds(db: Db, communityId: string): Promise<string[]> {
  const rows = await db.$client<{ user_id: string }[]>`
    SELECT user_id FROM practice_community_members WHERE community_id = ${communityId}`;
  return rows.map((r) => r.user_id);
}

export async function isWorkplaceCommunityMember(
  db: Db,
  communityId: string,
  userId: string,
): Promise<boolean> {
  const ids = await listWorkplaceCommunityMemberIds(db, communityId);
  return ids.includes(userId);
}

/** §8E3 — logos are admin-uploaded only, never scraped. Default is a
 * generated placeholder: initials + a deterministic colour from the name,
 * so every institution/certification community has a stable, non-random
 * visual identity even with no uploaded logo. */
export function communityInitialsPlaceholder(name: string): { initials: string; colorClass: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words[0]?.[0] ?? "?") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "");
  const palette = [
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-amber-100 text-amber-700",
    "bg-purple-100 text-purple-700",
    "bg-rose-100 text-rose-700",
    "bg-teal-100 text-teal-700",
  ];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { initials: initials.toUpperCase(), colorClass: palette[hash % palette.length] };
}

export async function getCommunityById(db: Db, communityId: string) {
  const [community] = await db.select().from(communities).where(eq(communities.id, communityId));
  return community ?? null;
}
