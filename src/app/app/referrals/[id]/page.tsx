// §8D — the referral detail page. Poster and receiving-therapist views
// share the same route; ReferralDetailActions branches on role.

import { notFound } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { areas, homeCaseReferrals, homeVisitAreas, referralInterest, users } from "@/db/schema";
import { DISCONTINUED_REASON_LABELS, REFERRAL_OUTCOME_LABELS, ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS, timeAgoLabel } from "@/lib/referral-labels";
import {
  canViewPatientSummaryOnReferral,
  canViewReferralDetail,
  loadAuthzUser,
} from "@/lib/referral-actions";
import { canViewReferralOutcomes, listReferralOutcomeTimeline } from "@/lib/referral-outcomes";
import { canViewCaseBrief, type CaseBrief } from "@/lib/case-brief";
import { getMyPeerNoteForReferral } from "@/lib/peer-notes";
import { ReferralDetailActions } from "./referral-detail-actions";
import { CITY_WIDE_LOCALITY_LABEL, firstLookDisclosure } from "@/lib/copy";
import { CaseBriefPanel } from "./case-brief-panel";
import { PeerNotePanel } from "./peer-note-panel";

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
      extendedOnce: homeCaseReferrals.extendedOnce,
      caseBrief: homeCaseReferrals.caseBrief,
      initialCircleId: homeCaseReferrals.initialCircleId,
      firstLookCommunityId: homeCaseReferrals.firstLookCommunityId,
      firstLookTherapistId: homeCaseReferrals.firstLookTherapistId,
      circleFirstWindow: homeCaseReferrals.circleFirstWindow,
      circleFirstOpenedAt: homeCaseReferrals.circleFirstOpenedAt,
      publicRefCode: homeCaseReferrals.publicRefCode,
      createdAt: homeCaseReferrals.createdAt,
      localityName: areas.name,
      areaScope: homeCaseReferrals.areaScope,
    })
    .from(homeCaseReferrals)
    .leftJoin(areas, eq(areas.id, homeCaseReferrals.areaId))
    .where(and(eq(homeCaseReferrals.id, id), isNull(homeCaseReferrals.deletedAt)));

  if (!referral) notFound();

  const interestRowsRaw = await db
    .select({
      interestId: referralInterest.id,
      therapistUserId: referralInterest.therapistUserId,
      status: referralInterest.status,
      shortlistedAt: referralInterest.shortlistedAt,
      displayName: users.displayName,
      slug: users.slug,
      photoUrl: users.photoUrl,
      specializations: users.specializations,
      verificationStage: users.verificationStage,
    })
    .from(referralInterest)
    .innerJoin(users, eq(users.id, referralInterest.therapistUserId))
    .where(and(eq(referralInterest.referralId, id), isNull(referralInterest.deletedAt)));

  // Phase 4 — candidate-card.tsx needs a locality per candidate (the
  // shortlist is the highest-stakes decision in the product; a bare
  // checkbox + name gave the poster nothing to go on). Same batched
  // one-representative-area-per-profile pattern as directory.ts's
  // localityByUserId, not the filter's own area.
  const candidateUserIds = interestRowsRaw.map((r) => r.therapistUserId);
  const localityRows =
    candidateUserIds.length > 0
      ? await db
          .select({ userId: homeVisitAreas.userId, areaName: areas.name })
          .from(homeVisitAreas)
          .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
          .where(and(inArray(homeVisitAreas.userId, candidateUserIds), isNull(homeVisitAreas.deletedAt)))
      : [];
  const localityByUserId = new Map<string, string>();
  for (const row of localityRows) {
    if (!localityByUserId.has(row.userId)) localityByUserId.set(row.userId, row.areaName);
  }
  const interestRows = interestRowsRaw.map((r) => ({
    ...r,
    shortlistedAt: r.shortlistedAt?.toISOString() ?? null,
    localityLabel: localityByUserId.get(r.therapistUserId) ?? null,
  }));

  const myInterest = interestRows.find((r) => r.therapistUserId === userId) ?? null;
  const isPoster = referral.postedByUserId === userId;
  const isAccepter = myInterest?.status === "accepted";
  const acceptedInterest = interestRows.find((r) => r.status === "accepted") ?? null;

  const inFirstLook = Boolean(referral.circleFirstWindow) && !referral.circleFirstOpenedAt;
  if (!canViewReferralDetail({ ...referral, inFirstLook }, userId, myInterest !== null)) {
    notFound();
  }

  // Never sent to the client at all when the viewer can't see it — the
  // same "don't even serialize it" discipline as patient_summary, not
  // just a client-side hide.
  const caseBrief = canViewCaseBrief(isPoster, isAccepter) ? (referral.caseBrief as CaseBrief | null) : null;

  // Phase 5 — the peer note prompt needs the OTHER party's name (poster
  // sees the accepter's name; the accepter sees the poster's, which
  // isn't otherwise loaded on this page) and whatever the viewer has
  // already written for this referral, if anything.
  let posterDisplayName: string | null = null;
  if (isAccepter) {
    const [posterRow] = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, referral.postedByUserId));
    posterDisplayName = posterRow?.displayName ?? null;
  }
  const peerNoteSubjectDisplayName = isPoster ? (acceptedInterest?.displayName ?? null) : posterDisplayName;
  const myPeerNote =
    referral.status === "completed" && (isPoster || isAccepter)
      ? await getMyPeerNoteForReferral(db, userId, id)
      : null;

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
            {referral.areaScope === "city" ? CITY_WIDE_LOCALITY_LABEL : (referral.localityName ?? "—")} ·{" "}
            {referral.homeVisitRequired ? "Home visit" : "Clinic visit"} ·{" "}
            {timeAgoLabel(referral.createdAt)}
          </p>
        </div>
        {referral.urgency === "urgent" && (
          <span className="rounded-md bg-destructive/10 px-2.5 py-1 text-xs font-bold uppercase text-destructive">
            Urgent
          </span>
        )}
      </div>

      {referral.additionalContext && (
        <p className="mt-4 text-sm text-card-foreground">{referral.additionalContext}</p>
      )}

      {/* Phase 5 — circle-first disclosure, shown to everyone who sees
          the referral, poster and receiving therapists alike ("disclosed
          in the state line to everyone who later sees it," per the
          plan). Never affects ordering or wording for anyone outside the
          circle — this is purely informational. */}
      {referral.circleFirstWindow && (
        <p className="mt-2 text-xs text-muted-foreground">
          {firstLookDisclosure({
            circle: Boolean(referral.initialCircleId),
            community: Boolean(referral.firstLookCommunityId),
            therapist: Boolean(referral.firstLookTherapistId),
          })}
        </p>
      )}

      {/* Phase 5 — the referral receipt. Only exists once the referral
          has actually completed (generatePublicRefCode runs inside
          reportOutcomeTx's completion transition) — a shareable,
          printable record of this one handoff. */}
      {referral.publicRefCode && (
        <p className="mt-2 text-xs">
          <a href={`/r/${referral.publicRefCode}`} className="font-semibold text-primary hover:underline">
            View receipt ({referral.publicRefCode})
          </a>
        </p>
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
                <span className="ml-2 text-xs text-muted-foreground">{timeAgoLabel(t.createdAt)}</span>
                {t.note && <p className="mt-0.5 text-muted-foreground">{t.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <CaseBriefPanel
          referralId={referral.id}
          referralStatus={referral.status}
          isPoster={isPoster}
          isAccepter={isAccepter}
          caseBrief={caseBrief}
        />
      </div>

      <div className="mt-4">
        <PeerNotePanel
          referralId={referral.id}
          referralStatus={referral.status}
          isPoster={isPoster}
          isAccepter={isAccepter}
          subjectDisplayName={peerNoteSubjectDisplayName}
          myNote={myPeerNote}
        />
      </div>

      <div className="mt-6">
        <ReferralDetailActions
          referralId={referral.id}
          isPoster={isPoster}
          referralStatus={referral.status}
          urgency={referral.urgency}
          // The candidate list is the poster's decision surface only — a
          // receiving therapist never needs (and was previously sent) every
          // other matched therapist's name and status.
          interested={isPoster ? interestRows : []}
          myInterest={myInterest}
          offerExpiresAt={referral.offerExpiresAt?.toISOString() ?? null}
          extendedOnce={referral.extendedOnce}
        />
      </div>
    </main>
  );
}
