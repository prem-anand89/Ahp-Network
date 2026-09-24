// Round 2 step 6 — pledges (plan decisions 1 & 2). One mechanism, two
// targets: a city (a therapist outside Hyderabad signs up and pledges,
// waitlisted until their city is unlocked) and a user-proposed community
// (others pledge, an admin creates it at the threshold). "Unlock is a
// human action, never automatic" (decision 1) — reaching PLEDGE_THRESHOLD
// only makes a target eligible for an admin to act on
// (getPledgeThresholdSummary), following the same live-query-on-an-admin-
// page pattern as liveness.ts's heartbeat alerts and referral-ops.ts's
// overdue-referral list, rather than a stored "task" row.

import { and, count, eq, inArray } from "drizzle-orm";
import {
  areas,
  communities,
  communityMembers,
  communityProposals,
  masterCouncils,
  pledges,
  unlockedCities,
  users,
} from "@/db/schema";
import type { getDb } from "@/db/db";
import { isPledgeCityOption, PLEDGE_CITY_OPTIONS, PLEDGE_THRESHOLD } from "./pledge-options";

type Db = Awaited<ReturnType<typeof getDb>>;

export { PLEDGE_THRESHOLD, PLEDGE_CITY_OPTIONS, isPledgeCityOption };

/**
 * A therapist outside Hyderabad who can't complete onboarding (no
 * curated locality to pick — see the "not in Hyderabad?" fallback next
 * to AreaSelector in onboarding-flow.tsx) pledges instead: waitlisted,
 * no directory listing, no matching, no referral posting. profileStatus
 * = 'waitlisted' is what actually enforces that — every matching/
 * directory/picker query already requires 'active' specifically.
 */
export async function pledgeForCityTx(db: Db, userId: string, city: string): Promise<{ pledgeCount: number }> {
  if (!isPledgeCityOption(city)) throw new Error("Choose a city from the list.");

  await db.insert(pledges).values({ userId, targetType: "city", targetCity: city }).onConflictDoNothing();

  // Only a still-onboarding ('draft') row moves to 'waitlisted' — an
  // already-active Hyderabad therapist pledging a second city out of
  // curiosity must never be demoted out of their own live profile.
  await db
    .update(users)
    .set({ profileStatus: "waitlisted", updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.profileStatus, "draft")));

  return { pledgeCount: await getCityPledgeCount(db, city) };
}

export async function getCityPledgeCount(db: Db, city: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(pledges)
    .where(and(eq(pledges.targetType, "city"), eq(pledges.targetCity, city)));
  return value;
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

// --- Admin surfacing (live queries, no stored "task" row — see file header) ---

export interface CityPledgeProgress {
  city: string;
  pledgeCount: number;
  unlocked: boolean;
  hasAreaTree: boolean;
  hasStatutoryCouncil: boolean;
}

/** Decision 1's two unlock prerequisites: a curated areas tree (a city-
 * level row with at least one descendant zone/locality) and that state's
 * statutory council. Both must exist before an admin can meaningfully
 * unlock — without a tree there's nowhere to pick a locality, without a
 * council no therapist there can ever reach credentials_verified. */
async function checkCityUnlockPrerequisites(db: Db, city: string, state: string): Promise<{ hasAreaTree: boolean; hasStatutoryCouncil: boolean }> {
  const [cityRow] = await db
    .select({ id: areas.id })
    .from(areas)
    .where(and(eq(areas.areaLevel, "city"), eq(areas.name, city), eq(areas.curationStatus, "approved"), eq(areas.isActive, true)));

  let hasAreaTree = false;
  if (cityRow) {
    const [{ value: descendantCount }] = await db
      .select({ value: count() })
      .from(areas)
      .where(and(eq(areas.curationStatus, "approved"), eq(areas.isActive, true), eq(areas.parentId, cityRow.id)));
    hasAreaTree = descendantCount > 0;
  }

  const [council] = await db
    .select({ id: masterCouncils.id })
    .from(masterCouncils)
    .where(
      and(
        eq(masterCouncils.state, state),
        eq(masterCouncils.councilType, "statutory_registration"),
        eq(masterCouncils.curationStatus, "approved"),
        eq(masterCouncils.isActive, true),
      ),
    );

  return { hasAreaTree, hasStatutoryCouncil: !!council };
}

/** Every candidate city (pledged at all, not already unlocked) with its
 * progress and prerequisite status — the admin pledges page's whole feed. */
export async function getCityPledgeProgress(db: Db): Promise<CityPledgeProgress[]> {
  const rows = await db
    .select({ city: pledges.targetCity, value: count() })
    .from(pledges)
    .where(eq(pledges.targetType, "city"))
    .groupBy(pledges.targetCity);

  const unlocked = await db.select({ city: unlockedCities.city }).from(unlockedCities);
  const unlockedSet = new Set(unlocked.map((u) => u.city));

  const results: CityPledgeProgress[] = [];
  for (const row of rows) {
    const city = row.city;
    if (!city || unlockedSet.has(city)) continue;
    const option = PLEDGE_CITY_OPTIONS.find((c) => c.name === city);
    const prereqs = option
      ? await checkCityUnlockPrerequisites(db, city, option.state)
      : { hasAreaTree: false, hasStatutoryCouncil: false };
    results.push({ city, pledgeCount: row.value, unlocked: false, ...prereqs });
  }
  return results.sort((a, b) => b.pledgeCount - a.pledgeCount);
}

/** Unlocking never auto-fires anything else (no bulk re-activation job) —
 * a pledged/waitlisted therapist re-visits onboarding themselves once
 * their city is live and picks up where the "not in Hyderabad?" fallback
 * left off. Refuses if either prerequisite is still missing — the whole
 * point of checking them is that a human can't skip past a red flag by
 * accident. */
export async function unlockCityTx(db: Db, adminUserId: string, city: string): Promise<void> {
  const option = PLEDGE_CITY_OPTIONS.find((c) => c.name === city);
  if (!option) throw new Error("Unknown city.");

  const prereqs = await checkCityUnlockPrerequisites(db, city, option.state);
  if (!prereqs.hasAreaTree) throw new Error(`${city} has no curated areas tree yet.`);
  if (!prereqs.hasStatutoryCouncil) throw new Error(`${city}'s state has no statutory council curated yet.`);

  await db.insert(unlockedCities).values({ city, unlockedByAdminId: adminUserId }).onConflictDoNothing();
}

export interface CommunityProposalProgress extends CommunityProposalSummary {
  proposedByUserId: string;
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
    })
    .from(communityProposals)
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

  await db
    .update(communityProposals)
    .set({ status: "created", createdCommunityId: community.id })
    .where(eq(communityProposals.id, proposalId));

  return { communityId: community.id };
}
