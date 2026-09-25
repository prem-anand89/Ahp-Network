"use client";

// Step 7I — shared by the areas/institutions/councils curation queues
// only, never credentials (that stays one-at-a-time; see this file's own
// header note in curation/actions.ts). Two additions over the old plain
// list: an age-since-submitted colour cue (never the only signal — the
// age is always shown as text too, per CLAUDE.md's badge-colour
// discipline), and checkbox-driven bulk approve/reject.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CurationQueueRow {
  id: string;
  createdAt: string; // ISO — passed as a string, this is a client component
  lines: string[]; // pre-formatted display lines, server-formatted
}

function ageLabel(createdAt: string): { label: string; hours: number } {
  const hours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (hours < 1) return { label: "just now", hours };
  if (hours < 24) return { label: `${Math.floor(hours)}h old`, hours };
  return { label: `${Math.floor(hours / 24)}d old`, hours };
}

export function BulkCurationQueue({
  rows,
  approveOne,
  rejectOne,
  approveMany,
  rejectMany,
}: {
  rows: CurationQueueRow[];
  approveOne: (id: string) => Promise<void>;
  rejectOne: (id: string) => Promise<void>;
  approveMany: (ids: string[]) => Promise<void>;
  rejectMany: (ids: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing pending.</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.size === rows.length}
            onChange={toggleAll}
            aria-label="Select all"
          />
          {selected.size > 0 ? `${selected.size} selected` : "Select all"}
        </label>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => startTransition(async () => {
                await approveMany([...selected]);
                setSelected(new Set());
              })}
            >
              Approve selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => startTransition(async () => {
                await rejectMany([...selected]);
                setSelected(new Set());
              })}
              className="border-destructive text-destructive hover:bg-destructive/10"
            >
              Reject selected
            </Button>
          </div>
        )}
      </div>

      <ul className="space-y-4">
        {rows.map((row) => {
          const age = ageLabel(row.createdAt);
          return (
            <li key={row.id} className="flex gap-3 rounded-md border p-4">
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() => toggle(row.id)}
                aria-label={`Select ${row.lines[0] ?? row.id}`}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  {row.lines[0] && <p className="font-medium">{row.lines[0]}</p>}
                  <span
                    className={cn(
                      "shrink-0 text-xs font-medium",
                      // Muted amber reuses the existing clay tag token
                      // rather than a new raw Tailwind color — see
                      // globals.css's own "no raw colour" deviation note.
                      age.hours >= 24 ? "text-brick" : age.hours >= 12 ? "text-tag-clay-fg" : "text-muted-foreground",
                    )}
                  >
                    {age.label}
                  </span>
                </div>
                {row.lines.slice(1).map((line, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    {line}
                  </p>
                ))}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => startTransition(() => approveOne(row.id))}
                    className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => startTransition(() => rejectOne(row.id))}
                    className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
