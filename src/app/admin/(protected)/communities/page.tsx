// Communities curation — pending community posts queue. §8G6,
// verification_admin or super_admin. Institution/certification curation
// and moderator applications already have their own queues (curation/) or
// mechanism (§8E3) — this screen owns pending community posts only.

import { eq } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { communities, communityPosts, users } from "@/db/schema";
import { approveCommunityPost, removeCommunityPost } from "./actions";

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

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
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
