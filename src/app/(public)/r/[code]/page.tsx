// Phase 5 — the referral receipt. A shareable, printable one-pager for a
// single completed referral, identified by its public_ref_code
// (R-YYYY-NNNN). Deliberately public (no session check): both parties
// already agreed to relay their identity to the other by the time a
// referral reaches this state, and every field shown here is already
// public elsewhere (therapist names via their own /pt/[slug] profiles,
// locality via the directory) — never patient_summary, never any
// patient-identifying detail. Per-referral, never per-person: nothing on
// this page or the query behind it counts receipts for a user.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/db/db";
import { getReceiptByCode } from "@/lib/referral-receipt";
import { REFERRAL_OUTCOME_LABELS, SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import { RegNumber } from "@/components/ui-ahp/reg-number";
import { SITE_METADATA } from "@/lib/site-metadata";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const db = await getDb();
  const receipt = await getReceiptByCode(db, code);
  if (!receipt) return {};

  const title = `Referral ${receipt.publicRefCode}`;
  const description = `${SPECIALIZATION_LABELS[receipt.specializationNeeded] ?? receipt.specializationNeeded} referral, completed on AHP Network.`;
  return {
    title,
    description,
    openGraph: {
      title: `${title} | ${SITE_METADATA.name}`,
      description,
      url: `${SITE_METADATA.url}/r/${receipt.publicRefCode}`,
      siteName: SITE_METADATA.name,
      type: "website",
    },
  };
}

export default async function ReferralReceiptPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = await getDb();
  const receipt = await getReceiptByCode(db, code);
  if (!receipt) notFound();

  return (
    <main className="mx-auto max-w-xl px-6 py-10 print:py-4">
      <div className="rounded-card-lg border p-6 print:border-0 print:p-0">
        <p className="font-mono text-xs tracking-wide text-muted-foreground">
          <RegNumber>{receipt.publicRefCode}</RegNumber>
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {SPECIALIZATION_LABELS[receipt.specializationNeeded] ?? receipt.specializationNeeded} referral
        </h1>

        <dl className="mt-4 flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Posted by</dt>
            <dd className="text-right font-medium">{receipt.posterDisplayName ?? "A therapist"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Accepted by</dt>
            <dd className="text-right font-medium">{receipt.accepterDisplayName ?? "A therapist"}</dd>
          </div>
          {receipt.localityName && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Locality</dt>
              <dd className="text-right font-medium">{receipt.localityName}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Completed</dt>
            <dd className="text-right font-medium">
              {receipt.completedAt.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
            </dd>
          </div>
          {receipt.outcome && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Outcome</dt>
              <dd className="text-right font-medium">
                {REFERRAL_OUTCOME_LABELS[receipt.outcome] ?? receipt.outcome}
              </dd>
            </div>
          )}
        </dl>

        <p className="mt-6 text-xs text-muted-foreground">
          A record of one professional handoff on {SITE_METADATA.name} — never patient details.
        </p>
      </div>

      <PrintButton />
    </main>
  );
}
