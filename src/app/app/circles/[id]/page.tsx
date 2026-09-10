// §8E2 — a single circle's member list. notFound() rather than redirect
// on a missing/not-owned circle: this is a private list, so "you don't
// have one by this id" should look identical to "this id doesn't exist",
// not leak which is true.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/db/db";
import { requireAuthUserId } from "@/lib/require-session";
import { getCircle, listCircleMembers } from "@/lib/circles";
import { CircleMembersManager } from "./circle-members-manager";

export const dynamic = "force-dynamic";

export default async function CircleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireAuthUserId();
  const db = await getDb();

  let circle;
  try {
    circle = await getCircle(db, userId, id);
  } catch {
    notFound();
  }

  const members = await listCircleMembers(db, userId, id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/app/circles" prefetch={false} className="text-sm text-muted-foreground hover:underline">
        ← Circles
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{circle.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Private to you. Nobody added here is notified, and nobody can see this list.
      </p>

      <div className="mt-8">
        <CircleMembersManager
          circleId={circle.id}
          initialMembers={members.map((m) => ({
            userId: m.userId,
            displayName: m.displayName,
          }))}
        />
      </div>
    </main>
  );
}
