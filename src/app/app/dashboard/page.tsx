// §10H — Network Activity as the dashboard home screen, not a side tab.
// Reciprocity stat (private, first-person), the completion checklist
// (§10G), and a link into the founding-cohort community (§8E3, Phase 8).

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getNetworkActivityFeed } from "@/lib/network-activity";
import { getReciprocityStats } from "@/lib/reciprocity";
import { ReferralCard } from "@/components/cards/referral-card";
import { Button } from "@/components/ui/button";
import { ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS, timeAgoLabel } from "@/lib/referral-labels";
import { COMPLETION_CHECKLIST_COPY } from "@/lib/copy";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const db = await getDb();
  const [me] = await db.select().from(users).where(eq(users.id, authUser.id));

  const profileIncomplete = !me?.displayName || !me?.role;

  const [feed, reciprocity] = await Promise.all([
    getNetworkActivityFeed(db, authUser.id),
    getReciprocityStats(db, authUser.id),
  ]);

  const checklist = [
    { done: (me?.specializations.length ?? 0) >= 3, copy: COMPLETION_CHECKLIST_COPY.skills, href: "/app/onboarding" },
    { done: Boolean(me?.photoUrl), copy: COMPLETION_CHECKLIST_COPY.photo, href: "/app/onboarding" },
    { done: Boolean(me?.availabilityUpdatedAt), copy: COMPLETION_CHECKLIST_COPY.availability, href: "/app/onboarding" },
    {
      done: me?.verificationStage !== "unverified",
      copy: COMPLETION_CHECKLIST_COPY.credentials,
      href: "/app/verification",
    },
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Network Activity</h1>

      {profileIncomplete && (
        <div className="mt-4 rounded-md border p-4">
          <p className="text-sm font-medium">Finish setting up your profile</p>
          <Button asChild size="sm" className="mt-2">
            <Link href="/app/onboarding">Continue</Link>
          </Button>
        </div>
      )}

      {(reciprocity.connectedThisMonth > 0 || reciprocity.invitedCount > 0) && (
        <div className="mt-4 flex flex-col gap-1 rounded-md border p-4 text-sm">
          {reciprocity.connectedThisMonth > 0 && (
            <p>You&apos;ve helped connect {reciprocity.connectedThisMonth} patient{reciprocity.connectedThisMonth === 1 ? "" : "s"} this month.</p>
          )}
          {reciprocity.invitedCount > 0 && (
            <p>{reciprocity.invitedCount} people joined AHP Network through your invite.</p>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/app/community">Founding cohort community</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/referrals">Referral board</Link>
        </Button>
      </div>

      {checklist.some((c) => !c.done) && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">Strengthen your profile</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {checklist
              .filter((c) => !c.done)
              .map((c) => (
                <li key={c.copy}>
                  <Link href={c.href} className="text-sm hover:underline">
                    {c.copy}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-4">
        {feed.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}
        {feed.map((item) =>
          item.kind === "referral" ? (
            <Link key={item.id} href={`/app/referrals/${item.id}`}>
              <ReferralCard
                specialtyLabel={
                  `${ROLE_NEEDED_LABELS[item.roleNeeded] ?? item.roleNeeded} — ${SPECIALIZATION_LABELS[item.specializationNeeded] ?? item.specializationNeeded}`
                }
                urgency={item.urgency}
                localityLabel={item.localityLabel}
                visitType={item.homeVisitRequired ? "home" : "clinic"}
                postedLabel={timeAgoLabel(item.createdAt)}
                nonMatchLabel={item.matchesViewer ? undefined : "Not in your area/specialty"}
              />
            </Link>
          ) : (
            <div key={item.userId} className="rounded-2xl border bg-card p-4 text-sm">
              <span className="font-medium">{item.displayName ?? "A new member"}</span> just joined —{" "}
              {item.role ? ROLE_NEEDED_LABELS[item.role] ?? item.role : "AHP Network"}
              {item.areaName ? `, ${item.areaName}` : ""}
            </div>
          ),
        )}
      </div>
    </main>
  );
}
