// §8E3 (Phase 8 narrow slice) — the founding-cohort community. Every
// pilot member can see and Like; only super_admin (the founder, at pilot)
// can post. No comments, no reply threads, no RSVP — by schema design.

import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";
import { getFoundingCommunity, listCommunityPosts } from "@/lib/communities";
import { CommunityFeed } from "./community-feed";

export const dynamic = "force-dynamic";

export default async function CommunityPage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const db = await getDb();
  const community = await getFoundingCommunity(db);
  const posts = await listCommunityPosts(db, community.id, authUser.id);
  const adminRoles = await getActiveAdminRoles(db, authUser.id);
  const canPost = adminRoles.includes("super_admin");

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{community.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Announcements, resources, and events from AHP Network — no comments, no reply threads.
      </p>

      <div className="mt-8">
        <CommunityFeed communityId={community.id} initialPosts={posts} canPost={canPost} />
      </div>
    </main>
  );
}
