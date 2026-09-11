"use server";

// Communities curation — pending community posts review, plus §8E3's
// moderator-application queue (self-nomination + admin approval). Post
// curation stays scoped to verification_admin/super_admin (or an approved
// community moderator for their own community — that narrower mechanism
// is separate and not checked here). Approving a moderator uses the same
// tier; revoking one is deliberately narrower (super_admin only, per
// §8E3: "revocable by super_admin, never re-votable").

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { communityPosts } from "@/db/schema";
import { approveModeratorTx, rejectModeratorApplicationTx, revokeModeratorTx } from "@/lib/community-moderators";

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

export async function approveModerator(moderatorRowId: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "manage_community_moderators" });
  await approveModeratorTx(db, moderatorRowId, adminUserId);
  revalidatePath("/admin/communities");
}

export async function rejectModeratorApplication(moderatorRowId: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "manage_community_moderators" });
  await rejectModeratorApplicationTx(db, moderatorRowId, adminUserId);
  revalidatePath("/admin/communities");
}

export async function revokeModerator(moderatorRowId: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "revoke_community_moderator" });
  await revokeModeratorTx(db, moderatorRowId, adminUserId);
  revalidatePath("/admin/communities");
}
