"use server";

// §8E3 (Phase 8 narrow slice) — the founding-cohort community's server
// actions. Posting is gated through authz's post_to_community (super_admin
// only, at pilot); liking/viewing are open to any signed-in therapist.

import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { can, type AuthzUser } from "@/lib/authz";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";
import { createCommunityPostTx, recordPostViewTx, togglePostLikeTx } from "@/lib/communities";

async function requireAuthzUser(): Promise<{ userId: string; authz: AuthzUser }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const db = await getDb();
  const [me] = await db.select().from(users).where(eq(users.id, user.id));
  const adminRoles = await getActiveAdminRoles(db, user.id);

  return {
    userId: user.id,
    authz: {
      id: user.id,
      accountType: me?.accountType ?? "therapist",
      verificationStage: me?.verificationStage ?? "unverified",
      adminRoles,
      contactDisclosureHoldUntil: me?.contactDisclosureHoldUntil ?? null,
    },
  };
}

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
