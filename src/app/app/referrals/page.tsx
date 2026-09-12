// §8D — the referral board. Two sections: referrals posted by the current
// therapist, and referrals matched to them (via referral_interest, which
// postReferralTx pre-populates as 'pending' for the whole matched pool at
// post time).

import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { areas, homeCaseReferrals, referralInterest } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { ReferralCard } from "@/components/cards/referral-card";
import { displayFor, type ReferralDisplayState } from "@/lib/referral-display";
import { REFERRAL_OUTCOME_LABELS, ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS, timeAgoLabel } from "@/lib/referral-labels";
import { listLatestOutcomes } from "@/lib/referral-outcomes";

export const dynamic = "force-dynamic";

// The receiving-therapist mirror of posterDisplayState: myInterestStatus is
// referral_interest.status, a separate enum from home_case_referrals.status.
// 'shortlisted'/'not_selected'/'withdrawn' either need per-referral data this
// list query doesn't load (offer countdown, who won) or have no ReferralDisplayState
// row at all — the detail page shows those in full. Where a real displayFor
// row exists and its receiving_therapist wording doesn't reference the
// unavailable field, reuse it (with a placeholder for that field) so the
// copy stays single-sourced and snapshot-tested.
function receivingDisplay(myInterestStatus: string): { label: string; detail: string } | null {
  switch (myInterestStatus) {
    case "pending":
      return displayFor({ kind: "interest_no_shortlist", interestedCount: 0 }, "receiving_therapist");
    case "shortlisted":
      return { label: "Offered to you", detail: "Open to respond" };
    case "accepted":
      return displayFor({ kind: "accepted_relay", accepterName: "" }, "receiving_therapist");
    case "not_selected":
      return { label: "Not selected", detail: "Someone else was chosen" };
    case "withdrawn":
      return { label: "Withdrawn", detail: "You withdrew interest" };
    case "missed":
      return displayFor({ kind: "missed", offeredToName: "" }, "receiving_therapist");
    case "declined":
      return displayFor({ kind: "declined", declinedByName: "" }, "receiving_therapist");
    default:
      return null;
  }
}

function posterDisplayState(
  status: string,
  interestedCount: number,
): ReferralDisplayState {
  switch (status) {
    case "open":
      return interestedCount > 0
        ? { kind: "interest_no_shortlist", interestedCount }
        : { kind: "open_no_interest" };
    case "completed":
      return { kind: "completed" };
    case "expired":
      return { kind: "expired" };
    default:
      // 'shortlisted'/'accepted'/'contact_acknowledged' need per-therapist
      // names this list view doesn't load — the detail page shows those.
      return { kind: "open_no_interest" };
  }
}

export default async function ReferralBoardPage() {
  const userId = await getVerifiedUserId();
  if (!userId) return null;

  const db = await getDb();

  // Independent queries — parallelized rather than sequential awaits, so
  // this page's total server round-trip is one query's latency, not two.
  const [posted, matched] = await Promise.all([
    db
      .select({
        id: homeCaseReferrals.id,
        status: homeCaseReferrals.status,
        urgency: homeCaseReferrals.urgency,
        roleNeeded: homeCaseReferrals.roleNeeded,
        specializationNeeded: homeCaseReferrals.specializationNeeded,
        homeVisitRequired: homeCaseReferrals.homeVisitRequired,
        createdAt: homeCaseReferrals.createdAt,
        localityName: areas.name,
      })
      .from(homeCaseReferrals)
      .leftJoin(areas, eq(areas.id, homeCaseReferrals.areaId))
      .where(and(eq(homeCaseReferrals.postedByUserId, userId), isNull(homeCaseReferrals.deletedAt)))
      .orderBy(desc(homeCaseReferrals.createdAt)),
    db
      .select({
        id: homeCaseReferrals.id,
        status: homeCaseReferrals.status,
        urgency: homeCaseReferrals.urgency,
        roleNeeded: homeCaseReferrals.roleNeeded,
        specializationNeeded: homeCaseReferrals.specializationNeeded,
        homeVisitRequired: homeCaseReferrals.homeVisitRequired,
        createdAt: homeCaseReferrals.createdAt,
        localityName: areas.name,
        myInterestStatus: referralInterest.status,
      })
      .from(referralInterest)
      .innerJoin(homeCaseReferrals, eq(homeCaseReferrals.id, referralInterest.referralId))
      .leftJoin(areas, eq(areas.id, homeCaseReferrals.areaId))
      .where(and(eq(referralInterest.therapistUserId, userId), isNull(referralInterest.deletedAt)))
      .orderBy(desc(homeCaseReferrals.createdAt)),
  ]);

  // §10 — "Referrals I raised — each row shows the latest outcome." Only
  // the poster's own list; the received list carries the report-status
  // action instead (a receiving therapist doesn't need to be told their
  // own last report).
  const latestOutcomes = await listLatestOutcomes(db, posted.map((r) => r.id));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Referral board</h1>
        <Button asChild>
          <Link href="/app/referrals/new" prefetch={false}>Post a referral</Link>
        </Button>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-muted-foreground">Posted by you</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {posted.length === 0 && <p className="text-sm text-muted-foreground">Nothing posted yet.</p>}
          {posted.map((r) => {
            const display = displayFor(posterDisplayState(r.status, 0), "poster");
            // A latest outcome (from the accepting therapist, post-handover)
            // is more specific and more current than posterDisplayState's
            // generic fallback for 'accepted'/'auto_closed' (which has no
            // per-therapist data at this list-view's query depth) — show it
            // in place of the generic detail line, never alongside a rate
            // or comparison.
            const latestOutcome = latestOutcomes.get(r.id);
            const detail = latestOutcome ? REFERRAL_OUTCOME_LABELS[latestOutcome.outcome] ?? latestOutcome.outcome : display?.detail;
            return (
              <Link key={r.id} href={`/app/referrals/${r.id}`} prefetch={false}>
                <ReferralCard
                  specialtyLabel={SPECIALIZATION_LABELS[r.specializationNeeded] ?? r.specializationNeeded}
                  urgency={r.urgency}
                  localityLabel={r.localityName ?? "—"}
                  visitType={r.homeVisitRequired ? "home" : "clinic"}
                  postedLabel={timeAgoLabel(r.createdAt)}
                  stateLabel={latestOutcome ? "Latest update" : display?.label}
                  stateDetail={detail}
                />
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-muted-foreground">Matched to you</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {matched.length === 0 && (
            <p className="text-sm text-muted-foreground">No matched referrals right now.</p>
          )}
          {matched.map((r) => {
            const display = receivingDisplay(r.myInterestStatus);
            return (
              <Link key={r.id} href={`/app/referrals/${r.id}`} prefetch={false}>
                <ReferralCard
                  specialtyLabel={ROLE_NEEDED_LABELS[r.roleNeeded] ?? r.roleNeeded}
                  urgency={r.urgency}
                  localityLabel={r.localityName ?? "—"}
                  visitType={r.homeVisitRequired ? "home" : "clinic"}
                  postedLabel={timeAgoLabel(r.createdAt)}
                  stateLabel={display?.label}
                  stateDetail={display?.detail}
                />
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
