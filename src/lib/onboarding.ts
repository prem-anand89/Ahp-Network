// §10B/§10C/§10D (Phase 8) — the onboarding sequence's data-layer pieces.
// UI lives in src/app/app/onboarding/; this file is what it calls into,
// following the DI-testable pattern established in Phase 6
// (referral-actions.ts): DB-taking functions here, thin "use server"
// wrappers at the call site.

import { and, count, desc, eq, gte, isNull, ne, or } from "drizzle-orm";
import {
  areas,
  communities,
  homeCaseReferrals,
  homeVisitAreas,
  userOnboardingMoments,
  users,
  type SpecializationType,
} from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export type OnboardingMoment =
  | "profile_preview_shown"
  | "locality_context_shown"
  | "verification_celebration_shown"
  | "share_card_generated";

/**
 * §10B — records a moment at most once per user (the unique index on
 * user_id+moment is the actual enforcement; ON CONFLICT DO NOTHING makes a
 * repeat call a no-op rather than an error).
 */
export async function recordOnboardingMoment(
  db: Db,
  userId: string,
  moment: OnboardingMoment,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db
    .insert(userOnboardingMoments)
    .values({ userId, moment, metadata })
    .onConflictDoNothing({ target: [userOnboardingMoments.userId, userOnboardingMoments.moment] });
}

export interface ProfileStep2Coverage {
  cityAreaId: string;
  areaId: string;
  tier: "primary" | "secondary";
}

export interface ProfileStep2Input {
  displayName: string;
  role: (typeof users.$inferInsert)["role"];
  /** The base locality — drives profile display, `city_area_id`, and
   * city-unlock counting. Must also appear in `coverage` (tier primary). */
  baseAreaId: string;
  /** Round 3 step C — every ticked zone/locality, across up to
   * MAX_COVERAGE_CITIES cities (area-coverage-picker.tsx), each row
   * carrying its own tier. Replaces the old single-`areaId` shape. */
  coverage: ProfileStep2Coverage[];
  /** Step 7B — "Your specialties (up to 3)", validated client-side against
   * the same cap the dashboard checklist already promises
   * (COMPLETION_CHECKLIST_COPY.skills). The DB column has no length CHECK
   * of its own (specializations is used unbounded elsewhere, e.g.
   * referral matching), so the cap is enforced here, once, not assumed
   * from the caller. Optional so existing callers/tests that predate this
   * field don't have to fabricate an answer. */
  specializations?: SpecializationType[];
  /** Step 7B — "Accepting new patients?" toggle on the same screen as the
   * live preview, instead of only reachable later from the dashboard
   * checklist. Optional so existing callers/tests that don't ask this
   * question yet don't have to fabricate an answer. */
  acceptingNewPatients?: boolean;
}

const MAX_ONBOARDING_SPECIALIZATIONS = 3;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "therapist"
  );
}

/**
 * `users_active_slug` is unique only among active, non-deleted rows (see
 * schema.ts) — matches that scope exactly rather than checking globally,
 * so this never retries against a slug that isn't actually going to
 * collide.
 */
async function generateUniqueSlug(db: Db, displayName: string): Promise<string> {
  const base = slugify(displayName);
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.slug, candidate), eq(users.profileStatus, "active"), isNull(users.deletedAt)));
    if (!existing) return candidate;
  }
}

/**
 * §10C step 2 — the three-field ask (name, role, locality), delivering
 * exactly what that step promises: "a live preview of their public
 * profile." This is the moment the profile actually goes live — slug
 * assigned, profile_status flipped to 'active', profile_visibility to
 * 'public' — matching §10C's fallback row for incomplete verification:
 * "the profile is live, listed, appears in directory search" even before
 * any credential is uploaded. One home-visit area row for their primary
 * locality; a therapist can add more coverage later from their profile.
 */
export async function completeProfileStep2Tx(db: Db, userId: string, input: ProfileStep2Input): Promise<void> {
  const [existing] = await db.select({ slug: users.slug }).from(users).where(eq(users.id, userId));
  const slug = existing?.slug ?? (await generateUniqueSlug(db, input.displayName));

  await db
    .update(users)
    .set({
      displayName: input.displayName,
      role: input.role,
      slug,
      profileStatus: "active",
      profileVisibility: "public",
      ...(input.specializations !== undefined
        ? { specializations: input.specializations.slice(0, MAX_ONBOARDING_SPECIALIZATIONS) }
        : {}),
      ...(input.acceptingNewPatients !== undefined
        ? { capacityState: input.acceptingNewPatients ? "available" : "not_taking", availabilityUpdatedAt: new Date() }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  // At least the base locality itself, even if coverage somehow arrived
  // empty — a therapist always covers where they say they're based.
  const rows = input.coverage.length > 0 ? input.coverage : [{ cityAreaId: input.baseAreaId, areaId: input.baseAreaId, tier: "primary" as const }];

  // No `target` — home_visit_areas_unique is a partial index (WHERE
  // deleted_at IS NULL), which drizzle's target-inference can't match
  // against a plain column-list arbiter. An untargeted DO NOTHING applies
  // regardless of which constraint would have fired.
  await db
    .insert(homeVisitAreas)
    .values(
      rows.map((r) => ({
        userId,
        areaId: r.areaId,
        tier: r.tier,
        isPrimary: r.areaId === input.baseAreaId ? true : undefined,
      })),
    )
    .onConflictDoNothing();
}

export interface LocalityContext {
  /** Real count of active therapists + open referrals in this locality. */
  count: number;
  /** §10D: "never a bare zero" — zero real signal switches to founding-cohort framing. */
  isFoundingCohortFraming: boolean;
}

/**
 * §10D — one rule: a real, specific count if ≥1 active therapist or open
 * referral in the locality, founding-cohort framing if zero. Never a bare
 * zero, anywhere this number is shown.
 */
export async function getLocalityContext(db: Db, areaId: string): Promise<LocalityContext> {
  const [{ therapistCount }] = await db
    .select({ therapistCount: count() })
    .from(homeVisitAreas)
    .innerJoin(users, eq(users.id, homeVisitAreas.userId))
    .where(
      and(
        eq(homeVisitAreas.areaId, areaId),
        isNull(homeVisitAreas.deletedAt),
        eq(users.accountType, "therapist"),
        eq(users.profileStatus, "active"),
      ),
    );

  const [{ referralCount }] = await db
    .select({ referralCount: count() })
    .from(homeCaseReferrals)
    .where(
      and(
        eq(homeCaseReferrals.areaId, areaId),
        eq(homeCaseReferrals.status, "open"),
        isNull(homeCaseReferrals.deletedAt),
      ),
    );

  const total = therapistCount + referralCount;
  return { count: total, isFoundingCohortFraming: total === 0 };
}

const SUGGESTED_CONNECTIONS_COUNT = 3;
/** Over-fetch before an in-JS shuffle (same pattern as directory.ts's
 * `_random` sort key) — never an ORDER BY random() full scan, and never a
 * sorted-by-any-count ordering, which §1A forbids surfacing to a viewer. */
const SUGGESTED_CONNECTIONS_POOL_SIZE = 20;

export interface SuggestedConnection {
  userId: string;
  displayName: string | null;
  role: string | null;
  verificationStage: string;
}

export interface SuggestedCommunity {
  id: string;
  name: string;
  slug: string;
}

export interface SuggestedConnections {
  therapists: SuggestedConnection[];
  community: SuggestedCommunity | null;
}

/**
 * Step 7B, onboarding step 2.5 — up to 3 other active, verified therapists
 * based in the same city to add to a Circle, plus 1 community to join.
 * Selection is a random draw from the eligible pool, never sorted by any
 * count or recency (§1A) — onboarding is not the place to imply some
 * members are more worth connecting with than others.
 */
export async function getSuggestedConnections(
  db: Db,
  userId: string,
  cityAreaId: string,
): Promise<SuggestedConnections> {
  // A therapist can have more than one home-visit row in the same city
  // (a zone plus a locality, say) — over-fetch and dedupe in JS, same
  // reasoning as getRecentNewMembers above (no selectDistinctOn in this
  // query builder).
  const therapistRows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      role: users.role,
      verificationStage: users.verificationStage,
    })
    .from(homeVisitAreas)
    .innerJoin(users, eq(users.id, homeVisitAreas.userId))
    .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
    .where(
      and(
        eq(areas.cityAreaId, cityAreaId),
        isNull(homeVisitAreas.deletedAt),
        eq(users.accountType, "therapist"),
        eq(users.profileStatus, "active"),
        isNull(users.deletedAt),
        ne(users.id, userId),
        ne(users.verificationStage, "unverified"),
      ),
    )
    .limit(SUGGESTED_CONNECTIONS_POOL_SIZE * 2);

  const seenTherapists = new Set<string>();
  const therapistPool: SuggestedConnection[] = [];
  for (const row of therapistRows) {
    if (seenTherapists.has(row.userId)) continue;
    seenTherapists.add(row.userId);
    therapistPool.push(row);
  }
  const therapists = therapistPool
    .map((row) => ({ row, _random: Math.random() }))
    .sort((a, b) => a._random - b._random)
    .slice(0, SUGGESTED_CONNECTIONS_COUNT)
    .map(({ row }) => row);

  const communityRows = await db
    .select({ id: communities.id, name: communities.name, slug: communities.slug })
    .from(communities)
    .leftJoin(areas, eq(areas.id, communities.areaId))
    .where(
      and(
        eq(communities.status, "active"),
        isNull(communities.deletedAt),
        or(eq(areas.cityAreaId, cityAreaId), isNull(communities.areaId)),
      ),
    )
    .limit(SUGGESTED_CONNECTIONS_POOL_SIZE);

  const seenCommunities = new Set<string>();
  const communityPool: SuggestedCommunity[] = [];
  for (const row of communityRows) {
    if (seenCommunities.has(row.id)) continue;
    seenCommunities.add(row.id);
    communityPool.push(row);
  }
  const community = communityPool.length > 0 ? communityPool[Math.floor(Math.random() * communityPool.length)] : null;

  return { therapists, community };
}

/** §10D — new-member cards need "recent" defined somewhere; feed-density is
 * the concern (§9), not a fixed news-cycle window, so this stays generous. */
const NEW_MEMBER_WINDOW_DAYS = 30;

export interface NewMemberCard {
  userId: string;
  displayName: string | null;
  role: string | null;
  areaName: string | null;
  verificationStage: string;
  createdAt: Date;
}

/**
 * §9/§10H — Network Activity feed's fix for zero-referral weeks: recent
 * verified signups, presence only, no interest/accept action. Reads off
 * users.created_at/verification_stage — no new schema.
 */
export async function getRecentNewMembers(db: Db, limit = 10): Promise<NewMemberCard[]> {
  const since = new Date(Date.now() - NEW_MEMBER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // A therapist can have more than one home-visit area, so this can return
  // more than one row per user — over-fetch and dedupe in JS (keeping the
  // first, i.e. most-recently-created, row) rather than a DISTINCT ON,
  // which drizzle's query builder doesn't expose.
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      role: users.role,
      areaName: areas.name,
      verificationStage: users.verificationStage,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(homeVisitAreas, and(eq(homeVisitAreas.userId, users.id), isNull(homeVisitAreas.deletedAt)))
    .leftJoin(areas, eq(areas.id, homeVisitAreas.areaId))
    .where(
      and(
        eq(users.accountType, "therapist"),
        eq(users.profileStatus, "active"),
        ne(users.verificationStage, "unverified"),
        gte(users.createdAt, since),
      ),
    )
    .orderBy(desc(users.createdAt))
    .limit(limit * 3);

  const seen = new Set<string>();
  const deduped: NewMemberCard[] = [];
  for (const row of rows) {
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    deduped.push(row);
    if (deduped.length >= limit) break;
  }
  return deduped;
}
