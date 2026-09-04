// §9/§10H — the Network Activity feed. Platform-wide, structured-fields-
// only view of every open referral, regardless of match, merged with
// recent-signup cards so the feed is never empty at pilot density. The
// "does this matter to me" flag (matchesViewer) is what referral-card.tsx
// uses to decide Express Interest vs. a plain non-match label — reuses the
// exact same predicate as referral-matching.ts's Step 1 filter (role +
// specialization + area coverage + accepting_referrals), plus verified-tier
// gating added since claiming itself requires credentials_verified (§8A3).

import { and, desc, eq, isNull } from "drizzle-orm";
import { areas, homeCaseReferrals, homeVisitAreas, users } from "@/db/schema";
import type { getDb } from "@/db/db";
import { getRecentNewMembers, type NewMemberCard } from "./onboarding";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface FeedReferralItem {
  kind: "referral";
  id: string;
  roleNeeded: string;
  specializationNeeded: string;
  urgency: "urgent" | "routine";
  homeVisitRequired: boolean;
  localityLabel: string;
  createdAt: Date;
  matchesViewer: boolean;
}

export interface FeedNewMemberItem extends NewMemberCard {
  kind: "new_member";
}

export type FeedItem = FeedReferralItem | FeedNewMemberItem;

export async function getNetworkActivityFeed(db: Db, viewerUserId: string): Promise<FeedItem[]> {
  const [viewer] = await db
    .select({
      role: users.role,
      specializations: users.specializations,
      acceptingReferrals: users.acceptingReferrals,
      verificationStage: users.verificationStage,
      acceptsHomeVisits: users.acceptsHomeVisits,
      acceptsClinicVisits: users.acceptsClinicVisits,
    })
    .from(users)
    .where(eq(users.id, viewerUserId));

  const viewerAreaRows = await db
    .select({ areaId: homeVisitAreas.areaId })
    .from(homeVisitAreas)
    .where(and(eq(homeVisitAreas.userId, viewerUserId), isNull(homeVisitAreas.deletedAt)));
  const viewerAreaIds = new Set(viewerAreaRows.map((r) => r.areaId));

  const referralRows = await db
    .select({
      id: homeCaseReferrals.id,
      roleNeeded: homeCaseReferrals.roleNeeded,
      specializationNeeded: homeCaseReferrals.specializationNeeded,
      urgency: homeCaseReferrals.urgency,
      homeVisitRequired: homeCaseReferrals.homeVisitRequired,
      createdAt: homeCaseReferrals.createdAt,
      localityName: areas.name,
      areaId: homeCaseReferrals.areaId,
      areaAncestorIds: areas.ancestorIds,
    })
    .from(homeCaseReferrals)
    .leftJoin(areas, eq(areas.id, homeCaseReferrals.areaId))
    .where(and(eq(homeCaseReferrals.status, "open"), isNull(homeCaseReferrals.deletedAt)))
    .orderBy(desc(homeCaseReferrals.createdAt));

  const referralItems: FeedReferralItem[] = referralRows.map((r) => {
    const coveringAreaIds = [r.areaId, ...(r.areaAncestorIds ?? [])].filter((id): id is string => id !== null);
    const areaMatches = coveringAreaIds.some((id) => viewerAreaIds.has(id));
    const visitTypeMatches = r.homeVisitRequired ? viewer?.acceptsHomeVisits : viewer?.acceptsClinicVisits;

    const matchesViewer = Boolean(
      viewer &&
        viewer.role === r.roleNeeded &&
        viewer.specializations.includes(r.specializationNeeded) &&
        viewer.acceptingReferrals &&
        viewer.verificationStage === "credentials_verified" &&
        areaMatches &&
        visitTypeMatches,
    );

    return {
      kind: "referral",
      id: r.id,
      roleNeeded: r.roleNeeded,
      specializationNeeded: r.specializationNeeded,
      urgency: r.urgency,
      homeVisitRequired: r.homeVisitRequired,
      localityLabel: r.localityName ?? "—",
      createdAt: r.createdAt,
      matchesViewer,
    };
  });

  const newMembers = await getRecentNewMembers(db);
  const newMemberItems: FeedNewMemberItem[] = newMembers.map((m) => ({ kind: "new_member", ...m }));

  return [...referralItems, ...newMemberItems].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
