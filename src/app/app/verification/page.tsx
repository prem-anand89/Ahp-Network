// [G5/H6] The pending/under-review state is a designed surface, not a
// spinner (plan §10E1) -- built here in Phase 3 with the credential flow,
// not in Phase 8's onboarding (ARCHITECTURE_REVIEW.md H6). Real expected
// time derived from current queue depth (§8A2's ~8-12 min/document
// capacity model), never a fixed "2 days" that can pass silently.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/db";
import { credentials } from "@/db/schema";

const MINUTES_PER_DOCUMENT = 10; // midpoint of §8A2's 8-12 min/document capacity model

export default async function VerificationStatusPage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login?next=/app/verification");

  const db = await getDb();

  const mine = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.userId, authUser.id), isNull(credentials.deletedAt)));

  const [{ count: queueDepth }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(credentials)
    .where(inArray(credentials.status, ["pending", "under_review"]));

  const pending = mine.filter((c) => c.status === "pending" || c.status === "under_review");
  const queryRaised = mine.filter((c) => c.status === "query_raised");
  const approved = mine.filter((c) => c.status === "approved");

  const estimatedMinutes = queueDepth * MINUTES_PER_DOCUMENT;
  const estimatedHours = Math.max(1, Math.round(estimatedMinutes / 60));

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Verification status</h1>

      {pending.length > 0 && (
        <div className="rounded-md border p-4">
          <p className="font-medium">Under review</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending.length} document{pending.length > 1 ? "s" : ""} awaiting review. Based on
            today&apos;s queue, expect a decision within roughly {estimatedHours} hour
            {estimatedHours !== 1 ? "s" : ""} — this updates as the queue moves, not a fixed
            promise.
          </p>
        </div>
      )}

      {queryRaised.length > 0 && (
        <div className="rounded-md border border-amber-500 p-4">
          <p className="font-medium">We need something from you</p>
          {queryRaised.map((c) => (
            <p key={c.id} className="mt-1 text-sm">
              {c.queryMessage}
            </p>
          ))}
        </div>
      )}

      {approved.length > 0 && (
        <div className="rounded-md border border-green-600 p-4">
          <p className="font-medium">Verified</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {approved.length} credential{approved.length > 1 ? "s" : ""} approved.
          </p>
        </div>
      )}

      {mine.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No credentials uploaded yet. A clear phone photo of a physical certificate is fine —
          you don&apos;t need a scan.
        </p>
      )}
    </main>
  );
}
