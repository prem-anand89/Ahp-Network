// §8D — the referral detail page. Poster and receiving-therapist views
// share the same route; ReferralDetailActions branches on role.

import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { areas, homeCaseReferrals, referralInterest, users } from "@/db/schema";
import { ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS, timeAgoLabel } from "@/lib/referral-labels";
import {
  canViewPatientSummaryOnReferral,
  canViewReferralDetail,
  loadAuthzUser,
} from "@/lib/referral-actions";
import { ReferralDetailActions } from "./referral-detail-actions";

export const dynamic = "force-dynamic";

export default async function ReferralDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

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

  const myInterest = interestRows.find((r) => r.therapistUserId === user.id) ?? null;
  const isPoster = referral.postedByUserId === user.id;

  if (!canViewReferralDetail(referral, user.id, myInterest !== null)) {
    notFound();
  }

  const authzUser = await loadAuthzUser(db, user.id);
  const canSeePatientSummary = canViewPatientSummaryOnReferral(
    authzUser,
    isPoster,
    myInterest?.status,
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {ROLE_NEEDED_LABELS[referral.roleNeeded]} — {SPECIALIZATION_LABELS[referral.specializationNeeded]}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {referral.localityName ?? "—"} · {referral.homeVisitRequired ? "Home visit" : "Clinic visit"} ·{" "}
            {timeAgoLabel(referral.createdAt)}
          </p>
        </div>
        {referral.urgency === "urgent" && (
          <span className="rounded-md bg-[color:var(--destructive)]/10 px-2.5 py-1 text-xs font-bold uppercase text-[color:var(--destructive)]">
            Urgent
          </span>
        )}
      </div>

      {referral.additionalContext && (
        <p className="mt-4 text-sm text-card-foreground">{referral.additionalContext}</p>
      )}

      {canSeePatientSummary && (
        <div className="mt-4 rounded-md border p-3">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">Patient summary</h2>
          <p className="mt-1 text-sm">{referral.patientSummary}</p>
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
