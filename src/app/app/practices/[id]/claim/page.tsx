// Phase 3 — /app/practices/[id]/claim. §8C1: proved the same way
// credentials are — document upload + admin review, never auto-approved.

import { eq, isNull, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { practices } from "@/db/schema";
import { ClaimForm } from "./claim-form";

export const dynamic = "force-dynamic";

export default async function ClaimPracticePage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getVerifiedUserId();
  if (!userId) return null;

  const { id } = await params;
  const db = await getDb();
  const [practice] = await db
    .select({ id: practices.id, name: practices.name, claimStatus: practices.claimStatus })
    .from(practices)
    .where(and(eq(practices.id, id), isNull(practices.deletedAt)));
  if (!practice) notFound();

  if (practice.claimStatus === "claimed") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{practice.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">This practice has already been claimed.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Claim {practice.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Claiming establishes ownership publicly — the Ownership Verified badge only appears once an
        admin has reviewed your document, never automatically.
      </p>
      <div className="mt-6">
        <ClaimForm practiceId={practice.id} />
      </div>
    </main>
  );
}
