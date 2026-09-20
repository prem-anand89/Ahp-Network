// [G5/H6] The pending/under-review state is a designed surface, not a
// spinner (plan §10E1) -- built here in Phase 3 with the credential flow,
// not in Phase 8's onboarding (ARCHITECTURE_REVIEW.md H6). Real expected
// time derived from current queue depth (§8A2's ~8-12 min/document
// capacity model), never a fixed "2 days" that can pass silently.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { credentials, masterCouncils, masterInstitutions, users } from "@/db/schema";
import { EnablePushButton } from "@/components/enable-push-button";
import { ShareInviteActions } from "./share-invite-actions";
import { CredentialUploadForm } from "./credential-upload-form";
import { recordOnboardingMoment } from "@/lib/onboarding";
import { CREDENTIAL_UPLOAD_DISCLOSURE, CREDENTIAL_UPLOAD_PHOTO_NOTE, verificationCelebrationCopy } from "@/lib/copy";
import { canUploadCredential as computeCanUploadCredential } from "@/lib/credential-upload-gate";

const MINUTES_PER_DOCUMENT = 10; // midpoint of §8A2's 8-12 min/document capacity model

// force-dynamic per page, not on the shared /app/* layout — see the
// comment on that layout for why.
export const dynamic = "force-dynamic";

export default async function VerificationStatusPage() {
  const userId = await getVerifiedUserId();
  // Session presence is gated in src/proxy.ts, same as the rest of /app/* —
  // never redirect() here, since that throws NEXT_REDIRECT during
  // client-side nav and reproduces the exact broken-transition bug that
  // moving the gate out of app/layout.tsx already fixed. userId should
  // never actually be null this far in; render nothing for that edge case
  // rather than a hard redirect.
  if (!userId) return null;

  const db = await getDb();

  // Five mutually independent queries — issued together. Run serially these
  // cost five cross-region round trips, which is most of this page's
  // time-to-first-byte.
  const [mine, queueRows, meRows, councils, institutions] = await Promise.all([
    db
      .select()
      .from(credentials)
      .where(and(eq(credentials.userId, userId), isNull(credentials.deletedAt))),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(credentials)
      .where(inArray(credentials.status, ["pending", "under_review"])),

    db
      .select({ verificationStage: users.verificationStage })
      .from(users)
      .where(eq(users.id, userId)),

    db
      .select({ id: masterCouncils.id, name: masterCouncils.name })
      .from(masterCouncils)
      .where(and(eq(masterCouncils.curationStatus, "approved"), eq(masterCouncils.isActive, true))),

    db
      .select({ id: masterInstitutions.id, name: masterInstitutions.name })
      .from(masterInstitutions)
      .where(and(eq(masterInstitutions.curationStatus, "approved"), eq(masterInstitutions.isActive, true))),
  ]);

  const [{ count: queueDepth }] = queueRows;
  const [me] = meRows;

  const pending = mine.filter((c) => c.status === "pending" || c.status === "under_review");
  const queryRaised = mine.filter((c) => c.status === "query_raised");
  const rejected = mine.filter((c) => c.status === "rejected");
  const hasApproved = mine.some((c) => c.status === "approved");

  // Bug fix (Phase 4), gating rule in src/lib/credential-upload-gate.ts:
  // this used to gate the upload form on mine.length === 0, so a
  // therapist whose only credential hit query_raised had NO control at
  // all — their only recourse was emailing an identity document to the
  // founder over consumer email. submitCredential (actions.ts) already
  // inserts a fresh row per attempt rather than overwriting, so the
  // review trail is preserved regardless of how many times this fires.
  const canUploadCredential = computeCanUploadCredential(mine);

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
    await recordOnboardingMoment(db, userId, "verification_celebration_shown", { tier: verifiedTier });
  }

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

      {queryRaised.length > 0 && !hasApproved && (
        <div className="rounded-md border border-amber-500 p-4">
          <p className="font-medium">We need something from you</p>
          {queryRaised.map((c) => (
            <p key={c.id} className="mt-1 text-sm">
              {c.queryMessage}
            </p>
          ))}
          <p className="mt-2 text-sm text-muted-foreground">Upload a new document below to resubmit.</p>
        </div>
      )}

      {rejected.length > 0 && !hasApproved && (
        <div className="rounded-md border border-amber-500 p-4">
          <p className="font-medium">Your last submission wasn&apos;t approved</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You can upload a new document below — this never permanently blocks verification.
          </p>
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

      {canUploadCredential && (
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
