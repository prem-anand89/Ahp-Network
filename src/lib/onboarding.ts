// §10B/§10C/§10D (Phase 8) — the onboarding sequence's data-layer pieces.
// UI lives in src/app/app/onboarding/; this file is what it calls into,
// following the DI-testable pattern established in Phase 6
// (referral-actions.ts): DB-taking functions here, thin "use server"
// wrappers at the call site.

import { and, count, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { areas, homeCaseReferrals, homeVisitAreas, userOnboardingMoments, users } from "@/db/schema";
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

export interface ProfileStep2Input {
  displayName: string;
  role: (typeof users.$inferInsert)["role"];
  areaId: string;
}

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
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  // No `target` — home_visit_areas_unique is a partial index (WHERE
  // deleted_at IS NULL), which drizzle's target-inference can't match
  // against a plain column-list arbiter. An untargeted DO NOTHING applies
  // regardless of which constraint would have fired.
  await db.insert(homeVisitAreas).values({ userId, areaId: input.areaId }).onConflictDoNothing();
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
