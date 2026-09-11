// §8E3 — browse and join communities (platform-curated, auto-generated,
// user-created). The founding-cohort community lives at its own
// /app/community page and isn't listed here — every pilot member is
// already in it by construction. Workplace communities aren't listed
// either: there's no join action, membership is computed live from
// practice_users.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { can } from "@/lib/authz";
import { loadAuthzUser } from "@/lib/require-session";
import { listJoinableCommunities, communityInitialsPlaceholder } from "@/lib/communities";
import { Button } from "@/components/ui/button";
import { joinCommunityAction, leaveCommunityAction } from "./actions";
import { CreateCommunityForm } from "./create-community-form";

export const dynamic = "force-dynamic";

const ORIGIN_LABELS: Record<string, string> = {
  platform_curated: "Community",
  auto_generated_institution: "Institution",
  auto_generated_certification: "Certification",
  user_created: "Member-created",
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

      <div className="mt-8 flex flex-col gap-3">
        {communities.length === 0 && <p className="text-sm text-muted-foreground">No communities yet.</p>}
        {communities.map((community) => {
          const placeholder = communityInitialsPlaceholder(community.name);
          return (
            <div key={community.id} className="flex items-center gap-4 rounded-2xl border bg-card p-4">
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${placeholder.colorClass}`}
                aria-hidden
              >
                {placeholder.initials}
              </div>
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
            </div>
          );
        })}
      </div>
    </main>
  );
}
