// §8E2 (Phase 9, first slice) — Circles: private, named lists a therapist
// keeps for themselves. Deliberately not on the main AppNav bar — the plan
// places this inside the therapist's own profile/settings area, not as a
// shared tab with the public Communities surface (§8E2's navigation-
// placement note). Reached from the dashboard's quick links instead.

import { getDb } from "@/db/db";
import { requireAuthUserId } from "@/lib/require-session";
import { listCircles } from "@/lib/circles";
import { CirclesManager } from "./circles-manager";

export const dynamic = "force-dynamic";

export default async function CirclesPage() {
  const userId = await requireAuthUserId();
  const db = await getDb();
  const circles = await listCircles(db, userId);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Circles</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Private, named lists of therapists you want to remember — for yourself only. Nobody added to a
        Circle is notified, and nobody can see that they were added.
      </p>

      <div className="mt-8">
        <CirclesManager
          initialCircles={circles.map((c) => ({
            id: c.id,
            name: c.name,
            memberCount: c.memberCount,
          }))}
        />
      </div>
    </main>
  );
}
