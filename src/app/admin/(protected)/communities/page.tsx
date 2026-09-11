// Communities curation — pending community posts, plus §8E3's moderator
// applications. §8G6, verification_admin or super_admin.

import { eq } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { communities, communityPosts, users } from "@/db/schema";
import { listPendingModeratorApplications } from "@/lib/community-moderators";
import { approveCommunityPost, removeCommunityPost, approveModerator, rejectModeratorApplication } from "./actions";

export default async function CommunitiesCurationPage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_communities_curation" });

  const pending = await db
    .select({
      id: communityPosts.id,
      title: communityPosts.title,
      body: communityPosts.body,
      type: communityPosts.type,
      communityName: communities.name,
      postedByEmail: users.email,
      postedByName: users.legalName,
      createdAt: communityPosts.createdAt,
    })
    .from(communityPosts)
    .innerJoin(communities, eq(communities.id, communityPosts.communityId))
    .innerJoin(users, eq(users.id, communityPosts.postedByUserId))
    .where(eq(communityPosts.status, "pending_review"))
    .orderBy(communityPosts.createdAt);

  const pendingModerators = await listPendingModeratorApplications(db);

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold">Communities — moderator applications</h1>
        {pendingModerators.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing pending.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pendingModerators.map((app) => (
              <li key={app.id} className="rounded-md border p-4">
                <p className="text-sm">
                  <span className="font-medium">{app.applicantName ?? app.applicantEmail}</span> applying to moderate{" "}
                  <span className="font-medium">{app.communityName}</span>
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={approveModerator.bind(null, app.id)}>
                    <button type="submit" className="rounded-md border px-3 py-1 text-sm hover:bg-accent">
                      Approve
                    </button>
                  </form>
                  <form action={rejectModeratorApplication.bind(null, app.id)}>
                    <button
                      type="submit"
                      className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h1 className="text-xl font-semibold">Communities — pending posts</h1>

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <ul className="space-y-4">
          {pending.map((post) => (
            <li key={post.id} className="rounded-md border p-4">
              <p className="text-xs text-muted-foreground">
                {post.communityName} — {post.type} — {post.postedByName ?? post.postedByEmail}
              </p>
              <p className="mt-1 font-medium">{post.title}</p>
              {post.body && <p className="mt-1 whitespace-pre-wrap text-sm">{post.body}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={approveCommunityPost.bind(null, post.id)}>
                  <button type="submit" className="rounded-md border px-3 py-1 text-sm hover:bg-accent">
                    Approve
                  </button>
                </form>
                <form action={removeCommunityPost.bind(null, post.id)}>
                  <button
                    type="submit"
                    className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
                  >
                    Remove
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
