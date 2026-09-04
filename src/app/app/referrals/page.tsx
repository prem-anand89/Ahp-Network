// §8D — the referral board. Two sections: referrals posted by the current
// therapist, and referrals matched to them (via referral_interest, which
// postReferralTx pre-populates as 'pending' for the whole matched pool at
// post time).

import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { areas, homeCaseReferrals, referralInterest } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { ReferralCard } from "@/components/cards/referral-card";
import { displayFor, type ReferralDisplayState } from "@/lib/referral-display";
import { ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS, timeAgoLabel } from "@/lib/referral-labels";

export const dynamic = "force-dynamic";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const db = await getDb();

  const posted = await db
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
    .where(and(eq(homeCaseReferrals.postedByUserId, user.id), isNull(homeCaseReferrals.deletedAt)))
    .orderBy(desc(homeCaseReferrals.createdAt));

  const matched = await db
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
    .where(and(eq(referralInterest.therapistUserId, user.id), isNull(referralInterest.deletedAt)))
    .orderBy(desc(homeCaseReferrals.createdAt));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Referral board</h1>
        <Button asChild>
          <Link href="/app/referrals/new">Post a referral</Link>
        </Button>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-muted-foreground">Posted by you</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {posted.length === 0 && <p className="text-sm text-muted-foreground">Nothing posted yet.</p>}
          {posted.map((r) => {
            const display = displayFor(posterDisplayState(r.status, 0), "poster");
            return (
              <Link key={r.id} href={`/app/referrals/${r.id}`}>
                <ReferralCard
                  specialtyLabel={SPECIALIZATION_LABELS[r.specializationNeeded] ?? r.specializationNeeded}
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

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-muted-foreground">Matched to you</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {matched.length === 0 && (
            <p className="text-sm text-muted-foreground">No matched referrals right now.</p>
          )}
          {matched.map((r) => (
            <Link key={r.id} href={`/app/referrals/${r.id}`}>
              <ReferralCard
                specialtyLabel={ROLE_NEEDED_LABELS[r.roleNeeded] ?? r.roleNeeded}
                urgency={r.urgency}
                localityLabel={r.localityName ?? "—"}
                visitType={r.homeVisitRequired ? "home" : "clinic"}
                postedLabel={timeAgoLabel(r.createdAt)}
              />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
