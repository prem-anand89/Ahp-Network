"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createCircleAction, deleteCircleAction } from "./actions";

interface CircleRow {
  id: string;
  name: string;
  memberCount: number;
}

export function CirclesManager({ initialCircles }: { initialCircles: CircleRow[] }) {
  const [circles, setCircles] = useState(initialCircles);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const circle = await createCircleAction(name);
      setCircles((prev) => [...prev, { id: circle.id, name: name.trim(), memberCount: 0 }]);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create circle");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(circleId: string) {
    setCircles((prev) => prev.filter((c) => c.id !== circleId));
    await deleteCircleAction(circleId);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="new-circle-name" className="text-sm font-medium">
            New circle
          </label>
          <input
            id="new-circle-name"
            required
            maxLength={100}
            placeholder="e.g. Trusted Home-Visit Therapists"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? "Creating…" : "Create"}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="divide-y rounded-md border">
        {circles.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No circles yet — create one above.</p>
        )}
        {circles.map((circle) => (
          <div key={circle.id} className="flex items-center justify-between px-4 py-3">
            <Link href={`/app/circles/${circle.id}`} className="text-sm font-medium hover:underline">
              {circle.name}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {circle.memberCount} {circle.memberCount === 1 ? "member" : "members"}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(circle.id)}
              className="text-xs text-muted-foreground hover:text-destructive hover:underline"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
