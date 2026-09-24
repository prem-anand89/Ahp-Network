// §8E3 — browse and join communities (platform-curated, auto-generated,
// user-created). The founding-cohort community lives at its own
// /app/community page and isn't listed here — every pilot member is
// already in it by construction. Workplace communities aren't listed
// either: there's no join action, membership is computed live from
// practice_users.

import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { can } from "@/lib/authz";
import { loadAuthzUser } from "@/lib/require-session";
import { listJoinableCommunities } from "@/lib/communities";
import { AvatarInitials } from "@/components/ui-ahp/avatar-initials";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui-ahp/empty-state";
import { ShareInviteActions } from "@/app/app/verification/share-invite-actions";
import { joinCommunityAction, leaveCommunityAction } from "./actions";
import { CreateCommunityForm } from "./create-community-form";
import { PledgeCommunitySection } from "./pledge-community-section";

export const dynamic = "force-dynamic";

const ORIGIN_LABELS: Record<string, string> = {
  platform_curated: "Community",
  auto_generated_institution: "Institution",
  auto_generated_certification: "Certification",
  user_created: "Member-created",
  user_pledged: "Member-pledged",
};

export default async function CommunitiesPage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const db = await getDb();
  const authz = await loadAuthzUser(db, authUser.id);
  const communities = await listJoinableCommunities(db, authUser.id);
  const canCreate = can(authz, { type: "create_community" }).allowed;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Communities</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Professional spaces you can join — announcements, resources, and events. No comments, no reply threads.
      </p>

      {canCreate && (
        <div className="mt-6">
          <CreateCommunityForm />
        </div>
      )}

      {/* Round 2 step 6 (decision 3) — "invite peers you trust," plain,
          no reward layer, reusing the same mechanism verification/page.tsx
          already ships. Communities grow from real invites, not a job
          that fires on its own until a group is well past the pilot's
          density gate (community-auto-generation.ts). */}
      <div className="mt-6 rounded-md border p-4">
        <h2 className="font-medium">Invite peers you trust</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The communities you&apos;d want to see here open once enough peers are on AHP Network.
        </p>
        <div className="mt-3">
          <ShareInviteActions />
        </div>
      </div>

      <div className="mt-6">
        <PledgeCommunitySection />
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {communities.length === 0 && (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title="No communities yet"
            body={
              canCreate
                ? "Create one above, or check back — institution and certification communities open as membership grows."
                : "Check back — institution and certification communities open as membership grows."
            }
          />
        )}
        {communities.map((community) => {
          return (
            <Card key={community.id} className="flex-row items-center gap-4 p-4">
              <AvatarInitials name={community.name} />
              <div className="min-w-0 flex-1">
                <Link href={`/app/communities/${community.id}`} prefetch={false} className="font-medium hover:underline">
                  {community.name}
                </Link>
                <p className="text-xs text-muted-foreground">{ORIGIN_LABELS[community.origin] ?? community.origin}</p>
              </div>
              <form action={(community.isMember ? leaveCommunityAction : joinCommunityAction).bind(null, community.id)}>
                <Button type="submit" size="sm" variant={community.isMember ? "outline" : "default"}>
                  {community.isMember ? "Leave" : "Join"}
                </Button>
              </form>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
