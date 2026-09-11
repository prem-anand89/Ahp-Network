// §8E3 — a single community's feed. Posting eligibility and the resulting
// post status are both origin-specific (see src/lib/communities.ts); this
// page only decides what to show, the server actions re-check everything
// authoritatively.

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { can } from "@/lib/authz";
import { loadAuthzUser } from "@/lib/require-session";
import {
  canSubmitToCommunity,
  getCommunityById,
  isCommunityMember,
  isWorkplaceCommunityMember,
  listCommunityPosts,
} from "@/lib/communities";
import { isApprovedModerator } from "@/lib/community-moderators";
import { CommunityFeed } from "@/components/community-feed";
import { Button } from "@/components/ui/button";
import { createCommunityPost, toggleLike, joinCommunityAction, leaveCommunityAction, applyForModeratorAction } from "../actions";

export const dynamic = "force-dynamic";

const MODERATABLE_ORIGINS = ["auto_generated_institution", "auto_generated_certification"];

export default async function CommunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const db = await getDb();
  const community = await getCommunityById(db, id);
  if (!community) notFound();

  const authz = await loadAuthzUser(db, authUser.id);
  const posterIsAdmin = can(authz, { type: "post_to_community" }).allowed;

  const [posts, canPost, isMember, isWorkplaceMember, isModerator] = await Promise.all([
    listCommunityPosts(db, community.id, authUser.id),
    canSubmitToCommunity(db, community.id, authUser.id, posterIsAdmin),
    isCommunityMember(db, community.id, authUser.id),
    community.origin === "auto_generated_practice"
      ? isWorkplaceCommunityMember(db, community.id, authUser.id)
      : Promise.resolve(false),
    MODERATABLE_ORIGINS.includes(community.origin)
      ? isApprovedModerator(db, community.id, authUser.id)
      : Promise.resolve(false),
  ]);

  const canApplyModerator =
    MODERATABLE_ORIGINS.includes(community.origin) &&
    authz.verificationStage !== "unverified" &&
    !isModerator &&
    !posterIsAdmin;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{community.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Announcements, resources, and events — no comments, no reply threads.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {community.origin === "auto_generated_practice" ? (
          <p className="text-xs text-muted-foreground">
            {isWorkplaceMember
              ? "You're a member — membership follows your affiliation with this practice."
              : "Membership follows an accepted affiliation with this practice."}
          </p>
        ) : (
          <form action={(isMember ? leaveCommunityAction : joinCommunityAction).bind(null, community.id)}>
            <Button type="submit" size="sm" variant={isMember ? "outline" : "default"}>
              {isMember ? "Leave" : "Join"}
            </Button>
          </form>
        )}
        {canApplyModerator && (
          <form action={applyForModeratorAction.bind(null, community.id)}>
            <Button type="submit" size="sm" variant="outline">
              Apply to moderate
            </Button>
          </form>
        )}
        {isModerator && <span className="text-xs text-muted-foreground">You&apos;re an approved moderator here.</span>}
      </div>

      <div className="mt-8">
        <CommunityFeed
          communityId={community.id}
          initialPosts={posts}
          canPost={canPost}
          eventsAllowed={false}
          createPost={createCommunityPost}
          toggleLike={toggleLike}
        />
      </div>
    </main>
  );
}
