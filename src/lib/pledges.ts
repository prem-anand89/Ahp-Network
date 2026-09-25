// Round 2 step 6 — pledges (plan decisions 1 & 2). One mechanism, two
// targets: a city (city open-pool unlock) and a user-proposed community
// (others pledge, an admin creates it at the threshold). "Unlock is a
// human action, never automatic" (decision 1) — reaching PLEDGE_THRESHOLD
// only makes a target eligible for an admin to act on
// (getCityPledgeProgress), following the same live-query-on-an-admin-
// page pattern as liveness.ts's heartbeat alerts and referral-ops.ts's
// overdue-referral list, rather than a stored "task" row.
//
// Round 3 step E rewrite — cities now come from the national areas
// registry (a real FK, target_city_area_id), not a short hand-picked
// PLEDGE_CITY_OPTIONS list. Pledging a city no longer waitlists anyone:
// everyone signs up and is listed nationally immediately (Round 3's
// whole premise); city unlock now gates only the open matched pool
// (enforced in referral-actions.ts's postReferralTx), not signup.

import { and, count, eq, inArray, isNull } from "drizzle-orm";
import {
  areas,
  communities,
  communityMembers,
  communityProposals,
  homeVisitAreas,
  masterCouncils,
  pledges,
  unlockedCities,
  users,
} from "@/db/schema";
import type { getDb } from "@/db/db";
import { PLEDGE_THRESHOLD } from "./pledge-options";

type Db = Awaited<ReturnType<typeof getDb>>;

export { PLEDGE_THRESHOLD };

/**
 * A pledge for a city that's not yet unlocked — advocacy, not a
 * requirement to participate (Round 3: signup/directory/matching/posting
 * a direct or circle/community referral all work nationally regardless
 * of unlock status; only the open matched pool waits, see
 * postReferralTx). cityAreaId must be a real, curated city-level area —
 * validated here rather than trusted from the client, same discipline as
 * every other area id this codebase accepts as input.
 */
export async function pledgeForCityTx(db: Db, userId: string, cityAreaId: string): Promise<{ pledgeCount: number }> {
  const [city] = await db
    .select({ id: areas.id })
    .from(areas)
    .where(and(eq(areas.id, cityAreaId), eq(areas.areaLevel, "city"), eq(areas.curationStatus, "approved"), eq(areas.isActive, true)));
  if (!city) throw new Error("Choose a valid city.");

  await db.insert(pledges).values({ userId, targetType: "city", targetCityAreaId: cityAreaId }).onConflictDoNothing();

  return { pledgeCount: await getCityContributorCount(db, cityAreaId) };
}

export interface CommunityProposalSummary {
  id: string;
  name: string;
  description: string | null;
  pledgeCount: number;
}

/** Proposing counts as the proposer's own pledge — they don't separately
 * tap "pledge" on a proposal they just wrote. */
export async function proposeCommunityTx(
  db: Db,
  userId: string,
  name: string,
  description: string | undefined,
): Promise<CommunityProposalSummary> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Name the community you're proposing.");

  const [proposal] = await db
    .insert(communityProposals)
    .values({ name: trimmedName, description: description?.trim() || null, proposedByUserId: userId })
    .returning({ id: communityProposals.id, name: communityProposals.name, description: communityProposals.description });

  await db
    .insert(pledges)
    .values({ userId, targetType: "community", targetCommunityProposalId: proposal.id })
    .onConflictDoNothing();

  return { ...proposal, pledgeCount: 1 };
}

/** Refuses a proposal that's already been created or declined — pledging
 * toward a decision that's already made isn't a real choice. */
export async function pledgeForCommunityTx(db: Db, userId: string, proposalId: string): Promise<{ pledgeCount: number }> {
  const [proposal] = await db.select({ status: communityProposals.status }).from(communityProposals).where(eq(communityProposals.id, proposalId));
  if (!proposal) throw new Error("That community proposal no longer exists.");
  if (proposal.status !== "open") throw new Error("This proposal is no longer open for pledges.");

  await db.insert(pledges).values({ userId, targetType: "community", targetCommunityProposalId: proposalId }).onConflictDoNothing();

  const [{ value }] = await db
    .select({ value: count() })
    .from(pledges)
    .where(eq(pledges.targetCommunityProposalId, proposalId));
  return { pledgeCount: value };
}

/** Open proposals with their live pledge counts, newest first — the
 * public-facing "pledge for a community" list. */
export async function listOpenCommunityProposals(db: Db): Promise<CommunityProposalSummary[]> {
  const open = await db
    .select({ id: communityProposals.id, name: communityProposals.name, description: communityProposals.description })
    .from(communityProposals)
    .where(eq(communityProposals.status, "open"))
    .orderBy(communityProposals.createdAt);

  if (open.length === 0) return [];

  const proposalIds = open.map((p) => p.id);
  const counts = await db
    .select({ proposalId: pledges.targetCommunityProposalId, value: count() })
    .from(pledges)
    .where(inArray(pledges.targetCommunityProposalId, proposalIds))
    .groupBy(pledges.targetCommunityProposalId);
  const countByProposal = new Map(counts.map((c) => [c.proposalId, c.value]));

  return open.map((p) => ({ ...p, pledgeCount: countByProposal.get(p.id) ?? 0 }));
}

// --- City unlock progress and admin surfacing ---

/** Distinct people who count toward a city's unlock progress: any active
 * therapist based there (home_visit_areas.is_primary), plus anyone who
 * explicitly pledged for it — "signing up in a city counts as a pledge;
 * there's no extra step" (plan). The UNION (not UNION ALL) is what dedupes
 * a based-there therapist who also happened to pledge. */
async function getCityContributorCount(db: Db, cityAreaId: string): Promise<number> {
  const basedThere = db
    .select({ contributorId: users.id })
    .from(users)
    .innerJoin(homeVisitAreas, and(eq(homeVisitAreas.userId, users.id), eq(homeVisitAreas.isPrimary, true), isNull(homeVisitAreas.deletedAt)))
    .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
    .where(and(eq(users.profileStatus, "active"), isNull(users.deletedAt), eq(areas.cityAreaId, cityAreaId)));

  const pledgedThere = db
    .select({ contributorId: pledges.userId })
    .from(pledges)
    .where(and(eq(pledges.targetType, "city"), eq(pledges.targetCityAreaId, cityAreaId)));

  const combined = await basedThere.union(pledgedThere);
  return new Set(combined.map((r) => r.contributorId)).size;
}

export interface CityPledgeProgress {
  cityAreaId: string;
  cityName: string;
  pledgeCount: number;
  hasAreaTree: boolean;
  hasStatutoryCouncil: boolean;
}

/** Round 3 step E — now informational only (see unlockCityTx): the
 * council prerequisite stopped being a hard blocker once either verified
 * tier could accept (Round 3 decision 1), so this is a checklist the
 * admin reads, not a gate they can be stopped by. The area-tree check is
 * close to vacuous under Round 3's model (every India Post-loaded city
 * already has a full tree by construction) but stays, since a therapist-
 * proposed city-level row (unlikely, but not impossible) genuinely could
 * have none yet. */
async function checkCityUnlockPrerequisites(db: Db, cityAreaId: string): Promise<{ hasAreaTree: boolean; hasStatutoryCouncil: boolean }> {
  const [cityRow] = await db
    .select({ id: areas.id, parentId: areas.parentId })
    .from(areas)
    .where(and(eq(areas.id, cityAreaId), eq(areas.areaLevel, "city"), eq(areas.curationStatus, "approved"), eq(areas.isActive, true)));
  if (!cityRow) return { hasAreaTree: false, hasStatutoryCouncil: false };

  const [{ value: descendantCount }] = await db
    .select({ value: count() })
    .from(areas)
    .where(and(eq(areas.curationStatus, "approved"), eq(areas.isActive, true), eq(areas.parentId, cityRow.id)));
  const hasAreaTree = descendantCount > 0;

  let hasStatutoryCouncil = false;
  if (cityRow.parentId) {
    const [stateRow] = await db
      .select({ name: areas.name })
      .from(areas)
      .where(and(eq(areas.id, cityRow.parentId), eq(areas.areaLevel, "state")));
    if (stateRow) {
      const [council] = await db
        .select({ id: masterCouncils.id })
        .from(masterCouncils)
        .where(
          and(
            eq(masterCouncils.state, stateRow.name),
            eq(masterCouncils.councilType, "statutory_registration"),
            eq(masterCouncils.curationStatus, "approved"),
            eq(masterCouncils.isActive, true),
          ),
        );
      hasStatutoryCouncil = !!council;
    }
  }

  return { hasAreaTree, hasStatutoryCouncil };
}

/** Every candidate city (someone based there, or pledged for it — not
 * already unlocked) with its progress and prerequisite checklist — the
 * admin pledges page's whole feed. */
export async function getCityPledgeProgress(db: Db): Promise<CityPledgeProgress[]> {
  const unlockedRows = await db.select({ cityAreaId: unlockedCities.cityAreaId }).from(unlockedCities);
  const unlockedSet = new Set(unlockedRows.map((u) => u.cityAreaId));

  const basedCityIds = await db
    .selectDistinct({ cityAreaId: areas.cityAreaId })
    .from(homeVisitAreas)
    .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
    .innerJoin(users, and(eq(users.id, homeVisitAreas.userId), eq(users.profileStatus, "active"), isNull(users.deletedAt)))
    .where(and(eq(homeVisitAreas.isPrimary, true), isNull(homeVisitAreas.deletedAt)));
  const pledgedCityIds = await db
    .selectDistinct({ cityAreaId: pledges.targetCityAreaId })
    .from(pledges)
    .where(eq(pledges.targetType, "city"));

  const candidateIds = new Set(
    [...basedCityIds.map((r) => r.cityAreaId), ...pledgedCityIds.map((r) => r.cityAreaId)].filter(
      (id): id is string => id !== null && !unlockedSet.has(id),
    ),
  );
  if (candidateIds.size === 0) return [];

  const cityRows = await db.select({ id: areas.id, name: areas.name }).from(areas).where(inArray(areas.id, [...candidateIds]));

  const results: CityPledgeProgress[] = [];
  for (const city of cityRows) {
    const [pledgeCount, prereqs] = await Promise.all([
      getCityContributorCount(db, city.id),
      checkCityUnlockPrerequisites(db, city.id),
    ]);
    results.push({ cityAreaId: city.id, cityName: city.name, pledgeCount, ...prereqs });
  }
  return results.sort((a, b) => b.pledgeCount - a.pledgeCount);
}

/** Progress for one city (the referral-post refusal message, and a
 * dashboard "Open referrals in Warangal: 7 of 25" card) — same counting
 * rule as getCityPledgeProgress, for a single known city rather than the
 * whole candidate list. */
export async function getCityProgress(db: Db, cityAreaId: string): Promise<{ pledgeCount: number; threshold: number }> {
  return { pledgeCount: await getCityContributorCount(db, cityAreaId), threshold: PLEDGE_THRESHOLD };
}

/** Unlocking never auto-fires anything else (no bulk re-activation job,
 * nothing was ever waitlisted to reactivate under Round 3) — it just
 * makes the city's open matched pool live for new and existing posts
 * alike. Prerequisites are informational only (see
 * checkCityUnlockPrerequisites) — a human admin can unlock past a
 * missing one deliberately; this only refuses a cityAreaId that isn't a
 * real, curated city at all. */
export async function unlockCityTx(db: Db, adminUserId: string, cityAreaId: string): Promise<void> {
  const [city] = await db
    .select({ id: areas.id })
    .from(areas)
    .where(and(eq(areas.id, cityAreaId), eq(areas.areaLevel, "city"), eq(areas.curationStatus, "approved"), eq(areas.isActive, true)));
  if (!city) throw new Error("Unknown or unapproved city.");

  await db.insert(unlockedCities).values({ cityAreaId, unlockedByAdminId: adminUserId }).onConflictDoNothing();
}

/** Whether a city's open matched pool is live — the one check
 * postReferralTx/openCircleFirstReferrals need. */
export async function isCityUnlocked(db: Db, cityAreaId: string): Promise<boolean> {
  const [row] = await db.select({ cityAreaId: unlockedCities.cityAreaId }).from(unlockedCities).where(eq(unlockedCities.cityAreaId, cityAreaId));
  return !!row;
}

export interface CommunityProposalProgress extends CommunityProposalSummary {
  proposedByUserId: string;
  proposedByDisplayName: string | null;
}

/** Open proposals at or past PLEDGE_THRESHOLD — the admin's "create this
 * one" queue. Below-threshold proposals stay off this list; they're
 * still visible (and pledgeable) on the public listOpenCommunityProposals
 * list above. */
export async function getCommunityProposalsAtThreshold(db: Db): Promise<CommunityProposalProgress[]> {
  const open = await db
    .select({
      id: communityProposals.id,
      name: communityProposals.name,
      description: communityProposals.description,
      proposedByUserId: communityProposals.proposedByUserId,
      proposedByDisplayName: users.displayName,
    })
    .from(communityProposals)
    .innerJoin(users, eq(users.id, communityProposals.proposedByUserId))
    .where(eq(communityProposals.status, "open"));

  if (open.length === 0) return [];

  const proposalIds = open.map((p) => p.id);
  const counts = await db
    .select({ proposalId: pledges.targetCommunityProposalId, value: count() })
    .from(pledges)
    .where(inArray(pledges.targetCommunityProposalId, proposalIds))
    .groupBy(pledges.targetCommunityProposalId);
  const countByProposal = new Map(counts.map((c) => [c.proposalId, c.value]));

  return open
    .map((p) => ({ ...p, pledgeCount: countByProposal.get(p.id) ?? 0 }))
    .filter((p) => p.pledgeCount >= PLEDGE_THRESHOLD)
    .sort((a, b) => b.pledgeCount - a.pledgeCount);
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "community"
  );
}

async function generateUniqueCommunitySlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, candidate));
    if (!existing) return candidate;
  }
}

/**
 * Decision 2 — "pledgers become members on creation... explicit opt-in
 * consent, not the auto-enrollment CLAUDE.md forbids for auto-generated
 * communities": every pledger (proposer included, since proposing counts
 * as a pledge) already opted in by pledging, so adding them as members
 * here is the fulfillment of that consent, not a new grant of it.
 */
export async function createCommunityFromProposalTx(db: Db, adminUserId: string, proposalId: string): Promise<{ communityId: string }> {
  const [proposal] = await db.select().from(communityProposals).where(eq(communityProposals.id, proposalId));
  if (!proposal) throw new Error("That community proposal no longer exists.");
  if (proposal.status !== "open") throw new Error("This proposal was already resolved.");

  // Claim the proposal (status: open -> created) BEFORE creating the
  // community, not after — the WHERE + rowcount check is what makes two
  // admins clicking "create" on the same proposal within the same
  // instant produce one community, not two. createCommunityId is filled
  // in with a second update once the community actually exists (its id
  // isn't known yet at claim time), but status flips here, atomically.
  const claimed = await db
    .update(communityProposals)
    .set({ status: "created" })
    .where(and(eq(communityProposals.id, proposalId), eq(communityProposals.status, "open")))
    .returning({ id: communityProposals.id });
  if (claimed.length === 0) throw new Error("This proposal was already resolved.");

  const slug = await generateUniqueCommunitySlug(db, proposal.name);

  const [community] = await db
    .insert(communities)
    .values({
      name: proposal.name,
      slug,
      type: "user_created",
      origin: "user_pledged",
      sourceProposalId: proposal.id,
      reviewedByAdminId: adminUserId,
    })
    .returning({ id: communities.id });

  const pledgerRows = await db
    .select({ userId: pledges.userId })
    .from(pledges)
    .where(eq(pledges.targetCommunityProposalId, proposalId));
  if (pledgerRows.length > 0) {
    await db
      .insert(communityMembers)
      .values(pledgerRows.map((p) => ({ communityId: community.id, userId: p.userId })))
      .onConflictDoNothing();
  }

  await db.update(communityProposals).set({ createdCommunityId: community.id }).where(eq(communityProposals.id, proposalId));

  return { communityId: community.id };
}
