"use client";

// Phase 5 — was "type the person's URL slug by hand, then
// window.location.reload()." Now a live name-search dropdown (same
// eligible-therapist set as the public directory) and useOptimistic
// updates — no reload, no knowing a URL in advance.

import { useOptimistic, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addCircleMemberByIdAction,
  removeCircleMemberAction,
  searchTherapistsForCircleAction,
} from "../actions";
import type { TherapistSearchResult } from "@/lib/directory";

interface MemberRow {
  userId: string;
  displayName: string | null;
}

const DEBOUNCE_MS = 300;

export function CircleMembersManager({
  circleId,
  initialMembers,
}: {
  circleId: string;
  initialMembers: MemberRow[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [optimisticMembers, addOptimisticMember] = useOptimistic(
    members,
    (state, added: MemberRow) => [...state, added],
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TherapistSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const memberIds = new Set(optimisticMembers.map((m) => m.userId));

  function handleQueryChange(value: string) {
    setQuery(value);
    clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchTherapistsForCircleAction(value));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
  }

  function handleAdd(result: TherapistSearchResult) {
    setError(null);
    const added: MemberRow = { userId: result.id, displayName: result.displayName };
    startTransition(async () => {
      addOptimisticMember(added);
      try {
        await addCircleMemberByIdAction(circleId, result.id);
        setMembers((prev) => [...prev, added]);
        setQuery("");
        setResults([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add that therapist");
      }
    });
  }

  function handleRemove(userId: string) {
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
    void removeCircleMemberAction(circleId, userId);
  }

  return (
    <div className="space-y-6">
      <div className="relative">
        <Label htmlFor="circle-member-search">Add a therapist</Label>
        <Input
          id="circle-member-search"
          placeholder="Search by name"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onBlur={() => setTimeout(() => setResults([]), 150)}
          className="mt-1.5"
        />
        {searching && <p className="mt-1 text-xs text-muted-foreground">Searching…</p>}
        {results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-card border bg-card shadow-sm">
            {results.map((result) => {
              const alreadyMember = memberIds.has(result.id);
              return (
                <li key={result.id}>
                  <button
                    type="button"
                    disabled={alreadyMember || isPending}
                    onMouseDown={() => !alreadyMember && handleAdd(result)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-default disabled:opacity-50"
                  >
                    <span>{result.displayName ?? "Unnamed profile"}</span>
                    {alreadyMember && <span className="text-xs text-muted-foreground">Already in this circle</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="divide-y rounded-md border">
        {optimisticMembers.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No one in this circle yet.</p>
        )}
        {optimisticMembers.map((member) => (
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
