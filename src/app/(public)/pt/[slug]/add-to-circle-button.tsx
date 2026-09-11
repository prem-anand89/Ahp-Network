"use client";

// §8E2 — "Add to Circle" from a therapist's public profile. Backend is
// entirely src/lib/circles.ts; this is UI over listCirclesWithMembership +
// addCircleMember/removeCircleMember/createCircle.
//
// No trace on this profile, ever: no count, no indicator, nothing that
// tells the person being viewed they were added to anyone's circle. That's
// not a UI restraint, it's the same structural guarantee Circles already
// has (§8E2) — this button is a second entry point into the same silent
// action, not a new consent surface. Never wire a revalidatePath of this
// route into the actions this button calls.

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import {
  createCircleAndAddAction,
  getCirclesForProfileAction,
  toggleCircleMembershipAction,
} from "../actions";
import type { CircleMembershipRow } from "@/lib/circles";

export function AddToCircleButton({ therapistUserId }: { therapistUserId: string }) {
  const [open, setOpen] = useState(false);
  const [circles, setCircles] = useState<CircleMembershipRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [newCircleName, setNewCircleName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCircles() {
    setLoading(true);
    setError(null);
    try {
      setCircles(await getCirclesForProfileAction(therapistUserId));
    } catch {
      setError("Couldn't load your circles");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(circleId: string, nextValue: boolean) {
    setCircles((prev) => (prev ? prev.map((c) => (c.id === circleId ? { ...c, isMember: nextValue } : c)) : prev));
    try {
      await toggleCircleMembershipAction(circleId, therapistUserId, nextValue);
    } catch {
      // Revert on failure — the optimistic flip above didn't stick server-side.
      setCircles((prev) => (prev ? prev.map((c) => (c.id === circleId ? { ...c, isMember: !nextValue } : c)) : prev));
      setError("Couldn't update that circle");
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newCircleName.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const circle = await createCircleAndAddAction(trimmed, therapistUserId);
      setCircles((prev) => (prev ? [...prev, circle] : [circle]));
      setNewCircleName("");
    } catch {
      setError("Couldn't create that circle");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && circles === null) void loadCircles();
      }}
    >
      <Popover.Trigger asChild>
        <Button type="button" size="sm" variant="outline">
          Add to Circle
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 w-72 rounded-md border bg-popover p-3 text-sm text-popover-foreground shadow-md"
        >
          {loading && <p className="text-muted-foreground">Loading your circles…</p>}

          {!loading && circles && (
            <div className="flex flex-col gap-3">
              {circles.length === 0 ? (
                <p className="text-muted-foreground">No circles yet — create one below.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {circles.map((circle) => (
                    <li key={circle.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`circle-${circle.id}`}
                        checked={circle.isMember}
                        onChange={(e) => handleToggle(circle.id, e.target.checked)}
                        className="size-4"
                      />
                      <label htmlFor={`circle-${circle.id}`} className="flex-1 truncate">
                        {circle.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={handleCreate} className="flex items-center gap-2 border-t pt-3">
                <input
                  type="text"
                  placeholder="New circle"
                  maxLength={100}
                  value={newCircleName}
                  onChange={(e) => setNewCircleName(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
                />
                <Button type="submit" size="sm" disabled={creating || !newCircleName.trim()}>
                  {creating ? "Adding…" : "Add"}
                </Button>
              </form>
            </div>
          )}

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
