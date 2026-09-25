// §8D — the referral board. Three tabs (Step 7E): referrals matched to
// the viewer, referrals they posted, and a broader network-wide explore
// view — reusing getNetworkActivityFeed's city-scoped query rather than a
// fourth hand-written one. The selected tab lives in a `?tab=` URL param,
// not client state, so a link or a refresh keeps it.

import Link from "next/link";
import { ClipboardList, Inbox, Globe } from "lucide-react";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { cityWideLocalityLabel } from "@/lib/copy";
import { areas, homeCaseReferrals, referralInterest, users } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { ReferralCard } from "@/components/cards/referral-card";
import { displayFor } from "@/lib/referral-display";
import { REFERRAL_OUTCOME_LABELS, ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS, timeAgoLabel } from "@/lib/referral-labels";
import { listLatestOutcomes } from "@/lib/referral-outcomes";
import { posterDisplayState, receivingDisplay } from "@/lib/referral-board-display";
import { EmptyState } from "@/components/ui-ahp/empty-state";
import { getNetworkActivityFeed, type FeedReferralItem } from "@/lib/network-activity";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Tab = "matched" | "posted" | "explore";

const TABS: { value: Tab; label: string }[] = [
  { value: "matched", label: "Matched to me" },
  { value: "posted", label: "My posts" },
  { value: "explore", label: "Explore network" },
];

export default async function ReferralBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const userId = await getVerifiedUserId();
  if (!userId) return null;

  const { tab: rawTab } = await searchParams;
  const tab: Tab = rawTab === "posted" || rawTab === "explore" ? rawTab : "matched";

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
        areaScope: homeCaseReferrals.areaScope,
        circleFirstWindow: homeCaseReferrals.circleFirstWindow,
      })
      .from(homeCaseReferrals)
      // Round 3 step D — coalesced so areas.name is the locality name OR
      // the city name for a city-wide row, in one join.
      .leftJoin(areas, sql`${areas.id} = coalesce(${homeCaseReferrals.areaId}, ${homeCaseReferrals.cityAreaId})`)
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
        areaScope: homeCaseReferrals.areaScope,
        myInterestStatus: referralInterest.status,
        offerExpiresAt: homeCaseReferrals.offerExpiresAt,
        circleFirstWindow: homeCaseReferrals.circleFirstWindow,
      })
      .from(referralInterest)
      .innerJoin(homeCaseReferrals, eq(homeCaseReferrals.id, referralInterest.referralId))
      .leftJoin(areas, sql`${areas.id} = coalesce(${homeCaseReferrals.areaId}, ${homeCaseReferrals.cityAreaId})`)
      .where(and(eq(referralInterest.therapistUserId, userId), isNull(referralInterest.deletedAt)))
      .orderBy(desc(homeCaseReferrals.createdAt)),
  ]);

  // Only fetched for the tab that needs it — this is a platform-wide,
  // city-scoped query (network-activity.ts), heavier than the two above.
  const exploreFeed =
    tab === "explore"
      ? (await getNetworkActivityFeed(db, userId)).filter((i): i is FeedReferralItem => i.kind === "referral")
      : [];

  // §10 — "Referrals I raised — each row shows the latest outcome." Only
  // the poster's own list; the received list carries the report-status
  // action instead (a receiving therapist doesn't need to be told their
  // own last report).
  const postedIds = posted.map((r) => r.id);
  const [latestOutcomes, pendingCounts, activeInterestRows] = await Promise.all([
    listLatestOutcomes(db, postedIds),
    // Bug fix (Phase 4) — real pending-interest count (was hardcoded to 0).
    postedIds.length > 0
      ? db
          .select({ referralId: referralInterest.referralId, count: sql<number>`count(*)::int` })
          .from(referralInterest)
          .where(
            and(
              inArray(referralInterest.referralId, postedIds),
              eq(referralInterest.status, "pending"),
              isNull(referralInterest.deletedAt),
            ),
          )
          .groupBy(referralInterest.referralId)
      : ([] as { referralId: string; count: number }[]),
    // Shortlisted/accepted therapist names for posterDisplayState.
    postedIds.length > 0
      ? db
          .select({
            referralId: referralInterest.referralId,
            status: referralInterest.status,
            displayName: users.displayName,
          })
          .from(referralInterest)
          .innerJoin(users, eq(users.id, referralInterest.therapistUserId))
          .where(
            and(
              inArray(referralInterest.referralId, postedIds),
              inArray(referralInterest.status, ["shortlisted", "accepted"]),
              isNull(referralInterest.deletedAt),
            ),
          )
      : ([] as { referralId: string; status: string; displayName: string | null }[]),
  ]);
  const pendingCountByReferral = new Map(pendingCounts.map((r) => [r.referralId, r.count]));
  const shortlistedNamesByReferral = new Map<string, string[]>();
  const accepterNameByReferral = new Map<string, string>();
  for (const row of activeInterestRows) {
    const name = row.displayName ?? "a therapist";
    if (row.status === "shortlisted") {
      const names = shortlistedNamesByReferral.get(row.referralId) ?? [];
      names.push(name);
      shortlistedNamesByReferral.set(row.referralId, names);
    } else if (row.status === "accepted") {
      accepterNameByReferral.set(row.referralId, name);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Referral board</h1>
        <Button asChild>
          <Link href="/app/referrals/new" prefetch={false}>Post a referral</Link>
        </Button>
      </div>

      <nav className="mt-6 flex items-center gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={t.value === "matched" ? "/app/referrals" : `/app/referrals?tab=${t.value}`}
            prefetch={false}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            aria-current={tab === t.value ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "posted" && (
      <section className="mt-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {posted.length === 0 && (
            <EmptyState
              className="sm:col-span-2"
              icon={<ClipboardList className="size-6" aria-hidden />}
              title="Nothing posted yet"
              body="Post a case and shortlist from therapists who match on role and specialty."
              action={
                <Button asChild size="sm">
                  <Link href="/app/referrals/new" prefetch={false}>Post a referral</Link>
                </Button>
              }
            />
          )}
          {posted.map((r) => {
            const display = displayFor(
              posterDisplayState(
                r.status,
                pendingCountByReferral.get(r.id) ?? 0,
                shortlistedNamesByReferral.get(r.id) ?? [],
                accepterNameByReferral.get(r.id) ?? null,
              ),
              "poster",
            );
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
                  localityLabel={r.areaScope === "city" ? cityWideLocalityLabel(r.localityName ?? "City") : (r.localityName ?? "—")}
                  visitType={r.homeVisitRequired ? "home" : "clinic"}
                  postedLabel={timeAgoLabel(r.createdAt)}
                  stateLabel={latestOutcome ? "Latest update" : display?.label}
                  stateDetail={detail}
                  circleFirst={Boolean(r.circleFirstWindow)}
                />
              </Link>
            );
          })}
        </div>
      </section>
      )}

      {tab === "matched" && (
      <section className="mt-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {matched.length === 0 && (
            <EmptyState
              className="sm:col-span-2"
              icon={<Inbox className="size-6" aria-hidden />}
              title="No matched referrals right now"
              body="A case shows up here when its role and specialty match your profile."
            />
          )}
          {matched.map((r) => {
            const display = receivingDisplay(r.myInterestStatus, r.offerExpiresAt);
            return (
              <Link key={r.id} href={`/app/referrals/${r.id}`} prefetch={false}>
                <ReferralCard
                  specialtyLabel={ROLE_NEEDED_LABELS[r.roleNeeded] ?? r.roleNeeded}
                  urgency={r.urgency}
                  localityLabel={r.areaScope === "city" ? cityWideLocalityLabel(r.localityName ?? "City") : (r.localityName ?? "—")}
                  visitType={r.homeVisitRequired ? "home" : "clinic"}
                  postedLabel={timeAgoLabel(r.createdAt)}
                  stateLabel={display?.label}
                  stateDetail={display?.detail}
                  circleFirst={Boolean(r.circleFirstWindow)}
                />
              </Link>
            );
          })}
        </div>
      </section>
      )}

      {tab === "explore" && (
      <section className="mt-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {exploreFeed.length === 0 && (
            <EmptyState
              className="sm:col-span-2"
              icon={<Globe className="size-6" aria-hidden />}
              title="Nothing open right now"
              body="Open referrals across your cities show up here, matched to you or not."
            />
          )}
          {exploreFeed.map((r) => (
            <Link key={r.id} href={`/app/referrals/${r.id}`} prefetch={false}>
              <ReferralCard
                specialtyLabel={`${ROLE_NEEDED_LABELS[r.roleNeeded] ?? r.roleNeeded} — ${SPECIALIZATION_LABELS[r.specializationNeeded] ?? r.specializationNeeded}`}
                urgency={r.urgency}
                localityLabel={r.localityLabel}
                visitType={r.homeVisitRequired ? "home" : "clinic"}
                postedLabel={timeAgoLabel(r.createdAt)}
                nonMatchLabel={r.matchesViewer ? undefined : "Not in your area/specialty"}
              />
            </Link>
          ))}
        </div>
      </section>
      )}
    </main>
  );
}
