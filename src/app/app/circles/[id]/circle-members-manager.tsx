"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addCircleMemberBySlugAction, removeCircleMemberAction } from "../actions";

interface MemberRow {
  userId: string;
  displayName: string | null;
}

export function CircleMembersManager({
  circleId,
  initialMembers,
}: {
  circleId: string;
  initialMembers: MemberRow[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [slug, setSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await addCircleMemberBySlugAction(circleId, slug);
      // Silent add, so the only feedback the owner needs is the list
      // updating — refetch isn't wired here, just clear the input; the
      // list reloads on next navigation via the server component above.
      setSlug("");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that therapist");
    } finally {
      setPending(false);
    }
  }

  async function handleRemove(userId: string) {
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    await removeCircleMemberAction(circleId, userId);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="add-member-slug">
            Add by profile link
          </Label>
          <Input
            id="add-member-slug"
            required
            placeholder="e.g. priya-sharma-pt (from their profile URL)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending || !slug.trim()}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="divide-y rounded-md border">
        {members.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No one in this circle yet.</p>
        )}
        {members.map((member) => (
          <div key={member.userId} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">{member.displayName ?? "Unnamed profile"}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRemove(member.userId)}
              className="text-xs text-muted-foreground hover:bg-transparent hover:text-destructive hover:underline"
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
