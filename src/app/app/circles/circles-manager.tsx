"use client";

// Step 7D — "+ Create circle" opens a sheet (name, then an optional
// member search reusing the same directory-name-search the circle detail
// page already has) instead of an inline text input + separate reload to
// add members. Avatar piles on each row use the design system's
// AvatarGroup/AvatarGroupCount primitives.

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { BookUser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui-ahp/empty-state";
import { createCircleAction, deleteCircleAction, addCircleMemberByIdAction, searchTherapistsForCircleAction } from "./actions";
import { CIRCLE_MEMBER_CAP } from "@/lib/circles";
import type { TherapistSearchResult } from "@/lib/directory";

interface MemberPreview {
  userId: string;
  displayName: string | null;
  photoUrl: string | null;
}

interface CircleRow {
  id: string;
  name: string;
  memberCount: number;
  preview: MemberPreview[];
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function CirclesManager({ initialCircles }: { initialCircles: CircleRow[] }) {
  const [circles, setCircles] = useState(initialCircles);

  async function handleDelete(circleId: string) {
    setCircles((prev) => prev.filter((c) => c.id !== circleId));
    await deleteCircleAction(circleId);
  }

  return (
    <div className="space-y-6">
      <CreateCircleSheet
        onCreated={(circle) => setCircles((prev) => [...prev, { ...circle, memberCount: 0, preview: [] }])}
      />

      <div className="divide-y rounded-md border">
        {circles.length === 0 && (
          <EmptyState
            className="border-none"
            icon={<BookUser className="size-6" aria-hidden />}
            title="No circles yet"
            body="Circles are private, named lists for yourself — create one above to start."
          />
        )}
        {circles.map((circle) => (
          <div key={circle.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <Link href={`/app/circles/${circle.id}`} className="flex min-w-0 items-center gap-3">
              {circle.preview.length > 0 && (
                <AvatarGroup>
                  {circle.preview.map((m) => (
                    <Avatar key={m.userId} size="sm">
                      {m.photoUrl && <AvatarImage src={m.photoUrl} alt="" />}
                      <AvatarFallback>{initials(m.displayName)}</AvatarFallback>
                    </Avatar>
                  ))}
                  {circle.memberCount > circle.preview.length && (
                    <AvatarGroupCount className="size-6 text-xs">
                      +{circle.memberCount - circle.preview.length}
                    </AvatarGroupCount>
                  )}
                </AvatarGroup>
              )}
              <span className="min-w-0 truncate text-sm font-medium hover:underline">
                {circle.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {circle.memberCount} {circle.memberCount === 1 ? "member" : "members"}
                </span>
              </span>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(circle.id)}
              className="shrink-0 text-xs text-muted-foreground hover:bg-transparent hover:text-destructive hover:underline"
            >
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateCircleSheet({ onCreated }: { onCreated: (circle: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCircle, setCreatedCircle] = useState<{ id: string; name: string } | null>(null);
  const [members, setMembers] = useState<{ userId: string; displayName: string | null }[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TherapistSearchResult[]>([]);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function reset() {
    setName("");
    setError(null);
    setCreatedCircle(null);
    setMembers([]);
    setQuery("");
    setResults([]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const circle = await createCircleAction(name);
      setCreatedCircle({ id: circle.id, name: name.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create circle");
    } finally {
      setCreating(false);
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        setResults(await searchTherapistsForCircleAction(value));
      } catch {
        setResults([]);
      }
    }, 300);
  }

  function handleAdd(result: TherapistSearchResult) {
    if (!createdCircle) return;
    setError(null);
    startTransition(async () => {
      try {
        await addCircleMemberByIdAction(createdCircle.id, result.id);
        setMembers((prev) => [...prev, { userId: result.id, displayName: result.displayName }]);
        setQuery("");
        setResults([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add that therapist");
      }
    });
  }

  function handleDone() {
    if (createdCircle) onCreated(createdCircle);
    setOpen(false);
    reset();
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        + Create circle
      </Button>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{createdCircle ? createdCircle.name : "Create a circle"}</SheetTitle>
          <SheetDescription>
            {createdCircle
              ? `Add up to ${CIRCLE_MEMBER_CAP} therapists — you can always come back and add more later.`
              : "A private, named list for yourself. Nobody added is notified."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {!createdCircle ? (
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-circle-name">Circle name</Label>
                <Input
                  id="new-circle-name"
                  required
                  maxLength={100}
                  autoFocus
                  placeholder="e.g. Trusted Home-Visit Therapists"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </form>
          ) : (
            <>
              <div className="relative">
                <Label htmlFor="circle-sheet-member-search">Add a therapist</Label>
                <Input
                  id="circle-sheet-member-search"
                  placeholder="Search by name"
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  onBlur={() => setTimeout(() => setResults([]), 150)}
                  className="mt-1.5"
                />
                {results.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full rounded-card border bg-card shadow-sm">
                    {results.map((result) => {
                      const already = members.some((m) => m.userId === result.id);
                      return (
                        <li key={result.id}>
                          <button
                            type="button"
                            disabled={already || isPending}
                            onMouseDown={() => !already && handleAdd(result)}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-default disabled:opacity-50"
                          >
                            <span>{result.displayName ?? "Unnamed profile"}</span>
                            {already && <span className="text-xs text-muted-foreground">Added</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}

              {members.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {members.map((m) => (
                    <li key={m.userId} className="rounded-md border px-3 py-2 text-sm">
                      {m.displayName ?? "Unnamed profile"}
                    </li>
                  ))}
                </ul>
              )}

              <SheetClose asChild>
                <Button type="button" onClick={handleDone}>
                  Done
                </Button>
              </SheetClose>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
