// REFERRAL_LOOP_SPEC_ADDENDUM.md §4/§7 — the accepting therapist's report
// screen. Eligibility mirrors reportOutcomeTx's own authz check exactly
// (interest 'accepted', referral at 'accepted' or later) so a therapist
// who isn't eligible gets notFound() here rather than a submit-time error.

import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { homeCaseReferrals, referralInterest } from "@/db/schema";
import { ReportOutcomeForm } from "./report-outcome-form";

export const dynamic = "force-dynamic";

export default async function ReportOutcomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getVerifiedUserId();
  if (!userId) return null;

  const db = await getDb();

  const [referral] = await db
    .select({ status: homeCaseReferrals.status, consentTextVersion: homeCaseReferrals.consentTextVersion })
    .from(homeCaseReferrals)
    .where(and(eq(homeCaseReferrals.id, id), isNull(homeCaseReferrals.deletedAt)));
  if (!referral) notFound();

  const [interest] = await db
    .select({ status: referralInterest.status })
    .from(referralInterest)
    .where(and(eq(referralInterest.referralId, id), eq(referralInterest.therapistUserId, userId)));

  // Same eligibility rule as authz.ts's report_referral_outcome case —
  // duplicated here only as a page-gate; reportOutcomeTx re-checks it
  // authoritatively on submit regardless.
  const eligible =
    interest?.status === "accepted" && ["accepted", "completed", "auto_closed"].includes(referral.status);
  if (!eligible) notFound();

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Report an update</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Shared only with the referring therapist — never shown publicly, never turned into a comparison.
      </p>
      <ReportOutcomeForm referralId={id} noteAllowed={referral.consentTextVersion === "2"} />
    </main>
  );
}
