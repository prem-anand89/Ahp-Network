// §8D — the referral detail page. Poster and receiving-therapist views
// share the same route; ReferralDetailActions branches on role.

import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { areas, homeCaseReferrals, referralInterest, users } from "@/db/schema";
import { TimeAgoDisplay } from "@/components/time-ago-display";
import { DISCONTINUED_REASON_LABELS, REFERRAL_OUTCOME_LABELS, ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import {
  canViewPatientSummaryOnReferral,
  canViewReferralDetail,
  loadAuthzUser,
} from "@/lib/referral-actions";
import { canViewReferralOutcomes, listReferralOutcomeTimeline } from "@/lib/referral-outcomes";
import { CIRCLE_TARGETED_RECIPIENT_LINE } from "@/lib/copy";
import { ReferralDetailActions } from "./referral-detail-actions";

export const dynamic = "force-dynamic";

export default async function ReferralDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getVerifiedUserId();
  if (!userId) return null;

  const db = await getDb();

  const [referral] = await db
    .select({
      id: homeCaseReferrals.id,
      status: homeCaseReferrals.status,
      urgency: homeCaseReferrals.urgency,
      postedByUserId: homeCaseReferrals.postedByUserId,
      roleNeeded: homeCaseReferrals.roleNeeded,
      specializationNeeded: homeCaseReferrals.specializationNeeded,
      homeVisitRequired: homeCaseReferrals.homeVisitRequired,
      additionalContext: homeCaseReferrals.additionalContext,
      patientSummary: homeCaseReferrals.patientSummary,
      offerExpiresAt: homeCaseReferrals.offerExpiresAt,
      createdAt: homeCaseReferrals.createdAt,
      localityName: areas.name,
      targetingMode: homeCaseReferrals.targetingMode,
      widenedAt: homeCaseReferrals.widenedAt,
    })
    .from(homeCaseReferrals)
    .leftJoin(areas, eq(areas.id, homeCaseReferrals.areaId))
    .where(and(eq(homeCaseReferrals.id, id), isNull(homeCaseReferrals.deletedAt)));

  if (!referral) notFound();

  const interestRows = await db
    .select({
      interestId: referralInterest.id,
      therapistUserId: referralInterest.therapistUserId,
      status: referralInterest.status,
      displayName: users.displayName,
    })
    .from(referralInterest)
    .innerJoin(users, eq(users.id, referralInterest.therapistUserId))
    .where(and(eq(referralInterest.referralId, id), isNull(referralInterest.deletedAt)));

  const myInterest = interestRows.find((r) => r.therapistUserId === userId) ?? null;
  const isPoster = referral.postedByUserId === userId;

  if (!canViewReferralDetail(referral, userId, myInterest !== null)) {
    notFound();
  }

  const authzUser = await loadAuthzUser(db, userId);
  const canSeePatientSummary = canViewPatientSummaryOnReferral(
    authzUser,
    isPoster,
    myInterest?.status,
  );

  // §7 — the poster reads the whole timeline; the accepting therapist
  // reads what they themselves reported. No one else, ever.
  const canSeeOutcomes = await canViewReferralOutcomes(userId, referral, myInterest?.status);
  const timeline = canSeeOutcomes ? await listReferralOutcomeTimeline(db, id) : [];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {ROLE_NEEDED_LABELS[referral.roleNeeded]} — {SPECIALIZATION_LABELS[referral.specializationNeeded]}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {referral.localityName ?? "—"} · {referral.homeVisitRequired ? "Home visit" : "Clinic visit"} ·{" "}
            <TimeAgoDisplay date={referral.createdAt} />
          </p>
        </div>
        {referral.urgency === "urgent" && (
          <span className="rounded-md bg-[color:var(--destructive)]/10 px-2.5 py-1 text-xs font-bold uppercase text-[color:var(--destructive)]">
            Urgent
          </span>
        )}
      </div>

      {/* Execution-plan Phase 4 — "selected," never a count, never the word
          "circle." Only shown to a notified recipient (never the poster,
          who already knows), and only before widening — once the pool
          opens up, comparing this line's presence across visits to the
          same referral would let someone infer the widen point. */}
      {!isPoster && myInterest && referral.targetingMode === "circle" && referral.widenedAt === null && (
        <p className="mt-3 text-sm text-muted-foreground">{CIRCLE_TARGETED_RECIPIENT_LINE}</p>
      )}

      {referral.additionalContext && (
        <p className="mt-4 text-sm text-card-foreground">{referral.additionalContext}</p>
      )}

      {canSeePatientSummary && (
        <div className="mt-4 rounded-md border p-3">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">Patient summary</h2>
          <p className="mt-1 text-sm">{referral.patientSummary}</p>
        </div>
      )}

      {timeline.length > 0 && (
        <div className="mt-4 rounded-md border p-3">
          {/* REFERRAL_LOOP_SPEC_ADDENDUM.md §10 — a timeline, never a rate
              or comparison. */}
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">Updates</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {timeline.map((t) => (
              <li key={t.id} className="text-sm">
                <span className="font-medium">{REFERRAL_OUTCOME_LABELS[t.outcome] ?? t.outcome}</span>
                {t.discontinuedReason && (
                  <span className="text-muted-foreground"> — {DISCONTINUED_REASON_LABELS[t.discontinuedReason] ?? t.discontinuedReason}</span>
                )}
                <span className="ml-2 text-xs text-muted-foreground"><TimeAgoDisplay date={t.createdAt} /></span>
                {t.note && <p className="mt-0.5 text-muted-foreground">{t.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <ReferralDetailActions
          referralId={referral.id}
          isPoster={isPoster}
          referralStatus={referral.status}
          urgency={referral.urgency}
          interested={interestRows}
          myInterest={myInterest}
          offerExpiresAt={referral.offerExpiresAt?.toISOString() ?? null}
        />
      </div>
    </main>
  );
}
