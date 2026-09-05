"use server";

// Communities curation — pending community posts review. §8G6 scopes this
// to verification_admin/super_admin (or an approved community moderator
// for their own community, §8E3 — that narrower mechanism is separate and
// not checked here).

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { communityPosts } from "@/db/schema";

export async function approveCommunityPost(postId: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "manage_communities_curation" });
  await db
    .update(communityPosts)
    .set({ status: "published", reviewedByAdminId: adminUserId })
    .where(eq(communityPosts.id, postId));
  revalidatePath("/admin/communities");
}

export async function removeCommunityPost(postId: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "manage_communities_curation" });
  await db
    .update(communityPosts)
    .set({ status: "removed", reviewedByAdminId: adminUserId })
    .where(eq(communityPosts.id, postId));
  revalidatePath("/admin/communities");
}
