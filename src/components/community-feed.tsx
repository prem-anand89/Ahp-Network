"use client";

// Shared feed UI for any community (§8E3) — the founding-cohort community
// (src/app/app/community) and the general communities surface
// (src/app/app/communities) both use this, passing their own server
// actions in rather than each maintaining a copy of this markup.

import { useState } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CommunityPostWithStats {
  id: string;
  type: "announcement" | "resource" | "event";
  title: string;
  body: string | null;
  url: string | null;
  status: "pending_review" | "published" | "removed";
  createdAt: string;
  likeCount: number;
  viewedByMe: boolean;
  likedByMe: boolean;
}

const TYPE_LABELS: Record<CommunityPostWithStats["type"], string> = {
  announcement: "Announcement",
  resource: "Resource",
  event: "Event",
};

export function CommunityFeed({
  communityId,
  initialPosts,
  canPost,
  eventsAllowed = true,
  createPost,
  toggleLike,
}: {
  communityId: string;
  initialPosts: CommunityPostWithStats[];
  canPost: boolean;
  /** Event posts stay P1 for every community except the founding cohort
   * (§8E3 — "Event posts stay deferred for every other Community type").
   * Defaults true since the founding-cohort page is this component's
   * only caller with events enabled today; the general communities
   * surface passes false explicitly. */
  eventsAllowed?: boolean;
  createPost: (input: {
    communityId: string;
    type: CommunityPostWithStats["type"];
    title: string;
    body?: string;
    url?: string;
  }) => Promise<{ id: string; status: "published" | "pending_review" }>;
  toggleLike: (postId: string) => Promise<{ liked: boolean }>;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [composing, setComposing] = useState(false);
  const [pendingNotice, setPendingNotice] = useState(false);

  async function handleLike(postId: string) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? -1 : 1) }
          : p,
      ),
    );
    await toggleLike(postId).catch(() => {
      // Reconciliation is deliberately skipped — a like/unlike is low-stakes
      // and a page refresh corrects any drift from a failed request.
    });
  }

  async function handleCompose(formData: FormData) {
    const type = formData.get("type") as CommunityPostWithStats["type"];
    const title = formData.get("title") as string;
    const body = (formData.get("body") as string) || undefined;
    const url = (formData.get("url") as string) || undefined;

    const { id, status } = await createPost({ communityId, type, title, body, url });
    setPosts((prev) => [
      { id, type, title, body: body ?? null, url: url ?? null, status, createdAt: new Date().toISOString(), likeCount: 0, likedByMe: false, viewedByMe: false },
      ...prev,
    ]);
    setPendingNotice(status === "pending_review");
    setComposing(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {canPost && (
        <div>
          {!composing ? (
            <Button onClick={() => setComposing(true)}>New post</Button>
          ) : (
            <form action={handleCompose} className="flex flex-col gap-3 rounded-md border p-4">
              <select name="type" required className="rounded-md border bg-background px-3 py-2 text-sm">
                <option value="announcement">Announcement</option>
                <option value="resource">Resource</option>
                {eventsAllowed && <option value="event">Event</option>}
              </select>
              <input name="title" required placeholder="Title" className="rounded-md border bg-background px-3 py-2 text-sm" />
              <textarea name="body" placeholder="Details (optional)" rows={3} className="rounded-md border bg-background px-3 py-2 text-sm" />
              <input name="url" placeholder="Link (resources only, optional)" className="rounded-md border bg-background px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <Button type="submit">Post</Button>
                <Button type="button" variant="outline" onClick={() => setComposing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {pendingNotice && (
            <p className="mt-2 text-sm text-muted-foreground">
              Your post is awaiting moderator review before it appears for other members.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {posts.length === 0 && <p className="text-sm text-muted-foreground">No posts yet.</p>}
        {posts.map((post) => (
          <div key={post.id} className="rounded-2xl border bg-card p-5 shadow-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {TYPE_LABELS[post.type]}
              {post.status === "pending_review" && " — awaiting review"}
            </span>
            <h3 className="mt-1 text-base font-semibold">{post.title}</h3>
            {post.body && <p className="mt-1 text-sm text-muted-foreground">{post.body}</p>}
            {post.url && (
              <a href={post.url} target="_blank" rel="noreferrer" className="mt-1 block text-sm text-primary hover:underline">
                {post.url}
              </a>
            )}
            <button
              onClick={() => handleLike(post.id)}
              className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <Heart className={`size-4 ${post.likedByMe ? "fill-current text-[color:var(--destructive)]" : ""}`} aria-hidden />
              {post.likeCount > 0 && post.likeCount}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
