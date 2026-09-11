"use server";

// §8E3 — general communities (beyond the founding-cohort community, which
// keeps its own dedicated actions.ts). Covers platform-curated,
// auto-generated, and user-created communities: join/leave (opt-in, never
// auto-enrolled — workplace communities have no join action at all, their
// membership is computed live), posting (status resolved per origin by
// createCommunityPostTx), liking/viewing, moderator applications, and
// admin community creation.

import { revalidatePath } from "next/cache";
import { can } from "@/lib/authz";
import { getDb } from "@/db/db";
import { requireAuthzUser } from "@/lib/require-session";
import { requireAdminAccess } from "@/lib/require-admin-access";
import {
  canSubmitToCommunity,
  createCommunity,
  createCommunityPostTx,
  getCommunityById,
  joinCommunityTx,
  leaveCommunityTx,
  recordPostViewTx,
  togglePostLikeTx,
  type CreateCommunityInput,
} from "@/lib/communities";
import { applyForModeratorTx } from "@/lib/community-moderators";

export async function joinCommunityAction(communityId: string) {
  const { userId } = await requireAuthzUser();
  const db = await getDb();
  await joinCommunityTx(db, communityId, userId);
  revalidatePath("/app/communities");
}

export async function leaveCommunityAction(communityId: string) {
  const { userId } = await requireAuthzUser();
  const db = await getDb();
  await leaveCommunityTx(db, communityId, userId);
  revalidatePath("/app/communities");
}

/**
 * Any signed-in member may submit — §8E3: "any member submits; publishes
 * immediately if posted by an approved moderator or admin, otherwise
 * enters pending_review." createCommunityPostTx resolves which of those
 * applies; this action only establishes who's posting and whether they
 * hold admin standing.
 */
export async function createCommunityPost(input: {
  communityId: string;
  type: "announcement" | "resource" | "event";
  title: string;
  body?: string;
  url?: string;
}) {
  const { userId, authz } = await requireAuthzUser();
  const posterIsAdmin = can(authz, { type: "post_to_community" }).allowed;

  const db = await getDb();
  const eligible = await canSubmitToCommunity(db, input.communityId, userId, posterIsAdmin);
  if (!eligible) throw new Error("Not eligible to post to this community");

  const result = await createCommunityPostTx(db, { ...input, postedByUserId: userId, posterIsAdmin });
  revalidatePath(`/app/communities/${input.communityId}`);
  return result;
}

export async function toggleLike(postId: string) {
  const { userId } = await requireAuthzUser();
  const db = await getDb();
  return togglePostLikeTx(db, postId, userId);
}

export async function recordView(postId: string) {
  const { userId } = await requireAuthzUser();
  const db = await getDb();
  await recordPostViewTx(db, postId, userId);
}

export async function applyForModeratorAction(communityId: string) {
  const { userId, authz } = await requireAuthzUser();
  if (authz.verificationStage === "unverified") {
    throw new Error("Applying to moderate requires a verified profile");
  }
  const db = await getDb();
  const community = await getCommunityById(db, communityId);
  if (!community || (community.origin !== "auto_generated_institution" && community.origin !== "auto_generated_certification")) {
    throw new Error("Moderator applications are only for institution/certification communities");
  }
  await applyForModeratorTx(db, communityId, userId);
  revalidatePath(`/app/communities/${communityId}`);
}

export async function createCommunityAction(input: CreateCommunityInput) {
  const { db } = await requireAdminAccess({ type: "create_community" });
  const result = await createCommunity(db, input);
  revalidatePath("/app/communities");
  return result;
}
