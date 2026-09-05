"use server";

// §8E3 (Phase 8 narrow slice) — the founding-cohort community's server
// actions. Posting is gated through authz's post_to_community (super_admin
// only, at pilot); liking/viewing are open to any signed-in therapist.

import { can } from "@/lib/authz";
import { getDb } from "@/db/db";
import { createCommunityPostTx, recordPostViewTx, togglePostLikeTx } from "@/lib/communities";
import { requireAuthzUser } from "@/lib/require-session";

export async function createFoundingCommunityPost(input: {
  communityId: string;
  type: "announcement" | "resource" | "event";
  title: string;
  body?: string;
  url?: string;
}) {
  const { userId, authz } = await requireAuthzUser();
  const result = can(authz, { type: "post_to_community" });
  if (!result.allowed) throw new Error(result.reason);

  const db = await getDb();
  return createCommunityPostTx(db, { ...input, postedByUserId: userId });
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
