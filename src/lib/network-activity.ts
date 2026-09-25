// §9/§10H — the Network Activity feed. Platform-wide, structured-fields-
// only view of every open referral, regardless of match, merged with
// recent-signup cards so the feed is never empty at pilot density. The
// "does this matter to me" flag (matchesViewer) is what referral-card.tsx
// uses to decide Express Interest vs. a plain non-match label — reuses the
// exact same predicate as referral-matching.ts's Step 1 filter (role +
// specialization + area coverage + accepting_referrals), plus verified-tier
// gating added since claiming itself requires a verified tier (§8A3,
// either qualification_confirmed or credentials_verified since Round 3
// decision 1). Not routed through can() itself — this only decides a
// display flag (Express Interest vs. a plain non-match label); the
// actual claim path (expressInterestTx, referral-actions.ts) calls
// can(authzUser, { type: "claim_referral" }) directly, so a stale value
// here would be a display nit, never a security gap.

import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { areas, homeCaseReferrals, homeVisitAreas, practiceUsers, practices, users } from "@/db/schema";
import type { getDb } from "@/db/db";
import { getRecentNewMembers, type NewMemberCard } from "./onboarding";
import { cityWideLocalityLabel } from "@/lib/copy";

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

// Round 3 step D (review finding 5) — a national platform can't show
// every open referral to every viewer the way the pre-Round-3, one-city
// pilot could; this caps how much the query and the in-memory sort do.
const FEED_LIMIT = 200;

export async function getNetworkActivityFeed(db: Db, viewerUserId: string): Promise<FeedItem[]> {
  // None of these four depends on another — only the in-memory .map below
  // consumes them, so they issue together. Sequential awaits here cost a
  // full cross-region round trip each (see the latency work in PR for
  // /app/* navigation).
  const [viewerRows, viewerAreaRows, viewerClinicAreaRows, newMembers] = await Promise.all([
    db
      .select({
        role: users.role,
        specializations: users.specializations,
        acceptingReferrals: users.acceptingReferrals,
        verificationStage: users.verificationStage,
        acceptsHomeVisits: users.acceptsHomeVisits,
        acceptsClinicVisits: users.acceptsClinicVisits,
      })
      .from(users)
      .where(eq(users.id, viewerUserId)),

    // Round 3 step D — also reads each covered area's own city, both to
    // bound the feed to the viewer's cities below and to check a clinic
    // referral's city_area_id (every active therapist has at least their
    // base/primary row here, so this is never empty for an active user).
    db
      .select({ areaId: homeVisitAreas.areaId, cityAreaId: areas.cityAreaId })
      .from(homeVisitAreas)
      .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
      .where(and(eq(homeVisitAreas.userId, viewerUserId), isNull(homeVisitAreas.deletedAt))),

    // Round 3 step D (D2, review fix) — the viewer's own base locality
    // and active practice locations, the same two sources
    // matchClinicByZoneOrCity reads for a clinic referral. Home-visit
    // coverage (above) is never a clinic-match signal — the earlier
    // version of this flag wrongly used the viewer's whole city
    // (secondary coverage included), which showed "Express Interest" on
    // clinic referrals expressInterestTx then rejected as a non-match.
    db
      .select({ areaId: areas.id, parentId: areas.parentId, cityAreaId: areas.cityAreaId })
      .from(homeVisitAreas)
      .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
      .where(
        and(eq(homeVisitAreas.userId, viewerUserId), eq(homeVisitAreas.isPrimary, true), isNull(homeVisitAreas.deletedAt)),
      )
      .union(
        db
          .select({ areaId: areas.id, parentId: areas.parentId, cityAreaId: areas.cityAreaId })
          .from(practiceUsers)
          .innerJoin(
            practices,
            and(eq(practices.id, practiceUsers.practiceId), isNull(practices.deletedAt), isNotNull(practices.areaId)),
          )
          .innerJoin(areas, eq(areas.id, practices.areaId))
          .where(
            and(
              eq(practiceUsers.userId, viewerUserId),
              eq(practiceUsers.status, "active"),
              isNull(practiceUsers.deletedAt),
              isNull(practiceUsers.endedAt),
            ),
          ),
      ),

    getRecentNewMembers(db),
  ]);

  const [viewer] = viewerRows;
  const viewerAreaIds = new Set(viewerAreaRows.map((r) => r.areaId));
  const viewerCityIds = new Set(
    viewerAreaRows.map((r) => r.cityAreaId).filter((id): id is string => id !== null),
  );

  // Round 3 step D (review finding 5) — "platform-wide activity" now
  // means the viewer's own cities, not literally every city in India;
  // a therapist with no city on file yet (shouldn't happen for an active
  // user, but defensive) sees no referral cards rather than the whole
  // country's.
  const referralRows =
    viewerCityIds.size === 0
      ? []
      : await db
          .select({
            id: homeCaseReferrals.id,
            roleNeeded: homeCaseReferrals.roleNeeded,
            specializationNeeded: homeCaseReferrals.specializationNeeded,
            urgency: homeCaseReferrals.urgency,
            homeVisitRequired: homeCaseReferrals.homeVisitRequired,
            createdAt: homeCaseReferrals.createdAt,
            localityName: areas.name,
            areaId: homeCaseReferrals.areaId,
            areaParentId: areas.parentId,
            areaScope: homeCaseReferrals.areaScope,
            areaAncestorIds: areas.ancestorIds,
            cityAreaId: homeCaseReferrals.cityAreaId,
          })
          .from(homeCaseReferrals)
          // Round 3 step D — joined on whichever of area_id/city_area_id
          // is set (exactly one, per area_scope), so areas.name resolves
          // to the locality name OR the city name in one join, instead of
          // a second lookup for the city-wide case.
          .leftJoin(areas, sql`${areas.id} = coalesce(${homeCaseReferrals.areaId}, ${homeCaseReferrals.cityAreaId})`)
          // Never a referral still inside its First Look window — it was
          // offered to a named circle/community/therapist first, and
          // listing it here would show it to exactly the people it was
          // held back from.
          .where(
            and(
              eq(homeCaseReferrals.status, "open"),
              isNull(homeCaseReferrals.deletedAt),
              or(isNull(homeCaseReferrals.circleFirstWindow), isNotNull(homeCaseReferrals.circleFirstOpenedAt)),
              inArray(homeCaseReferrals.cityAreaId, [...viewerCityIds]),
            ),
          )
          .orderBy(desc(homeCaseReferrals.createdAt))
          .limit(FEED_LIMIT);

  // Round 3 step D (D2, review fix) — resolving "same zone" needs to know
  // which parent ids are actually zones (vs. a locality filed straight
  // under its city). One batched lookup for every parentId this render
  // touches — the referral rows' own locality parents, plus the viewer's
  // base/practice area parents — rather than a query per row.
  const candidateParentIds = [
    ...new Set(
      [...referralRows.map((r) => r.areaParentId), ...viewerClinicAreaRows.map((r) => r.parentId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  const zoneParentIds =
    candidateParentIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ id: areas.id })
              .from(areas)
              .where(and(inArray(areas.id, candidateParentIds), eq(areas.areaLevel, "zone")))
          ).map((r) => r.id),
        );

  // Each side (the viewer's base/practice locations, and a clinic
  // referral's own locality) reduces to one "zone, or city if unzoned"
  // id — matching's own D2 rule, applied from both directions.
  const zoneOrCity = (parentId: string | null, cityAreaId: string | null): string | null =>
    parentId && zoneParentIds.has(parentId) ? parentId : cityAreaId;

  const viewerClinicZoneOrCityIds = new Set(
    viewerClinicAreaRows.map((r) => zoneOrCity(r.parentId, r.cityAreaId)).filter((id): id is string => id !== null),
  );

  const referralItems: FeedReferralItem[] = referralRows.map((r) => {
    // Round 3 step D (D2, review fix) — a clinic referral's "does this
    // match me" check now reads the viewer's base locality/active
    // practice locations at the referral's zone (or city, if unzoned),
    // the same rule matchClinicByZoneOrCity applies — never home-visit
    // coverage, which is the wrong direction for a visit the patient
    // travels to. A locality-scope home visit keeps the v1 ancestor_ids
    // coverage check.
    const coveringAreaIds = [r.areaId, ...(r.areaAncestorIds ?? [])].filter((id): id is string => id !== null);
    const referralZoneOrCity = r.areaScope === "city" ? r.cityAreaId : zoneOrCity(r.areaParentId, r.cityAreaId);
    const areaMatches = r.homeVisitRequired
      ? coveringAreaIds.some((id) => viewerAreaIds.has(id))
      : referralZoneOrCity !== null && viewerClinicZoneOrCityIds.has(referralZoneOrCity);
    const visitTypeMatches = r.homeVisitRequired ? viewer?.acceptsHomeVisits : viewer?.acceptsClinicVisits;

    const matchesViewer = Boolean(
      viewer &&
        viewer.role === r.roleNeeded &&
        viewer.specializations.includes(r.specializationNeeded) &&
        viewer.acceptingReferrals &&
        (viewer.verificationStage === "credentials_verified" || viewer.verificationStage === "qualification_confirmed") &&
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
      localityLabel: r.areaScope === "city" ? cityWideLocalityLabel(r.localityName ?? "City") : (r.localityName ?? "—"),
      createdAt: r.createdAt,
      matchesViewer,
    };
  });

  const newMemberItems: FeedNewMemberItem[] = newMembers.map((m) => ({ kind: "new_member", ...m }));

  return [...referralItems, ...newMemberItems].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
