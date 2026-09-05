// [G5/H6] The pending/under-review state is a designed surface, not a
// spinner (plan §10E1) -- built here in Phase 3 with the credential flow,
// not in Phase 8's onboarding (ARCHITECTURE_REVIEW.md H6). Real expected
// time derived from current queue depth (§8A2's ~8-12 min/document
// capacity model), never a fixed "2 days" that can pass silently.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/db";
import { credentials, masterCouncils, masterInstitutions, users } from "@/db/schema";
import { EnablePushButton } from "@/components/enable-push-button";
import { ShareInviteActions } from "./share-invite-actions";
import { CredentialUploadForm } from "./credential-upload-form";
import { recordOnboardingMoment } from "@/lib/onboarding";
import { CREDENTIAL_UPLOAD_DISCLOSURE, CREDENTIAL_UPLOAD_PHOTO_NOTE, verificationCelebrationCopy } from "@/lib/copy";

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

  const [me] = await db
    .select({ verificationStage: users.verificationStage })
    .from(users)
    .where(eq(users.id, authUser.id));

  const pending = mine.filter((c) => c.status === "pending" || c.status === "under_review");
  const queryRaised = mine.filter((c) => c.status === "query_raised");

  const estimatedMinutes = queueDepth * MINUTES_PER_DOCUMENT;
  const estimatedHours = Math.max(1, Math.round(estimatedMinutes / 60));

  // §10F — [v20] fires for BOTH tiers, once. Recorded here rather than
  // gating the section's visibility: reaching either tier is a durable
  // fact, not a one-time toast that should vanish on the next visit.
  const verifiedTier =
    me?.verificationStage === "credentials_verified" || me?.verificationStage === "qualification_confirmed"
      ? me.verificationStage
      : null;
  if (verifiedTier) {
    await recordOnboardingMoment(db, authUser.id, "verification_celebration_shown", { tier: verifiedTier });
  }

  const councils = await db
    .select({ id: masterCouncils.id, name: masterCouncils.name })
    .from(masterCouncils)
    .where(and(eq(masterCouncils.curationStatus, "approved"), eq(masterCouncils.isActive, true)));

  const institutions = await db
    .select({ id: masterInstitutions.id, name: masterInstitutions.name })
    .from(masterInstitutions)
    .where(and(eq(masterInstitutions.curationStatus, "approved"), eq(masterInstitutions.isActive, true)));

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

      {verifiedTier && (
        <div className="rounded-md border border-green-600 p-4">
          <p className="text-lg font-semibold">{verificationCelebrationCopy(verifiedTier).title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{verificationCelebrationCopy(verifiedTier).body}</p>
          <div className="mt-3">
            <ShareInviteActions />
          </div>
          {/* [H7]/Phase 7 — contextual, post-first-verification, never on page load. */}
          <div className="mt-3">
            <EnablePushButton />
          </div>
        </div>
      )}

      {mine.length === 0 && (
        <div className="rounded-md border p-4">
          <p className="text-sm">{CREDENTIAL_UPLOAD_DISCLOSURE}</p>
          <p className="mt-2 text-sm text-muted-foreground">{CREDENTIAL_UPLOAD_PHOTO_NOTE}</p>
          <div className="mt-4">
            <CredentialUploadForm councils={councils} institutions={institutions} />
          </div>
          {/* [v20/G7] — an explicit, first-class option, not a dead end. */}
          <Link href="/app/dashboard" className="mt-3 inline-block text-sm text-muted-foreground hover:underline">
            I&apos;ll do this later
          </Link>
        </div>
      )}
    </main>
  );
}
