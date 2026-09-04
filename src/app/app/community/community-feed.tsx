"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createFoundingCommunityPost, toggleLike } from "./actions";
import type { CommunityPostWithStats } from "@/lib/communities";

const TYPE_LABELS: Record<CommunityPostWithStats["type"], string> = {
  announcement: "Announcement",
  resource: "Resource",
  event: "Event",
};

export function CommunityFeed({
  communityId,
  initialPosts,
  canPost,
}: {
  communityId: string;
  initialPosts: CommunityPostWithStats[];
  canPost: boolean;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [composing, setComposing] = useState(false);

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

    const { id } = await createFoundingCommunityPost({ communityId, type, title, body, url });
    setPosts((prev) => [
      { id, type, title, body: body ?? null, url: url ?? null, createdAt: new Date(), likeCount: 0, likedByMe: false, viewedByMe: false },
      ...prev,
    ]);
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
                <option value="event">Event</option>
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
        </div>
      )}

      <div className="flex flex-col gap-4">
        {posts.length === 0 && <p className="text-sm text-muted-foreground">No posts yet.</p>}
        {posts.map((post) => (
          <div key={post.id} className="rounded-2xl border bg-card p-5 shadow-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {TYPE_LABELS[post.type]}
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
