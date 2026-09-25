// §8D — the referral board's core write paths, taking `db` and the
// resolved `userId` as explicit parameters (same DI pattern as
// submitPracticeClaimTx in practice-claims.ts) specifically so they're
// testable against a real local Postgres without needing
// getCloudflareContext or a Supabase auth session. The "use server" file
// at src/app/app/referrals/actions.ts is a thin wrapper resolving auth and
// calling into these.

import { eq, and, isNull, sql } from "drizzle-orm";
import {
  areas,
  circleMembers,
  circles,
  communities,
  communityMembers,
  homeCaseReferrals,
  notificationOutbox,
  referralEvents,
  referralInterest,
  users,
} from "@/db/schema";
import { can, type AuthzUser } from "@/lib/authz";
import { loadAuthzUser } from "@/lib/require-session";
import {
  countMatchesForReferral,
  MATCHING_ALGORITHM_VERSION,
  matchTherapistsForReferral,
  resolveReferralCityAreaId,
  type MatchCriteria,
} from "@/lib/referral-matching";
import { getCityProgress, isCityUnlocked } from "@/lib/pledges";
import { CONSENT_TEXT_VERSION } from "@/lib/copy";
import type { getDb } from "@/db/db";

// Phase 5 — circle-first referrals, generalized in Round 2 to "First
// Look" (plan decisions 7/8: a community, or one named therapist via the
// profile "Refer Patient" CTA, use the exact same window/expansion
// mechanism as a circle). Fixed, not per-post configurable: the plan
// names the mechanism without specifying a duration, and a fixed window
// keeps this a one-decision feature rather than a second scheduling UI.
export const CIRCLE_FIRST_WINDOW = "4 hours";

/** The one thing a First Look target ever is — never more than one kind
 * at once (home_case_referrals_first_look_single_target, drizzle/0046). */
export type FirstLookTarget =
  | { type: "circle"; id: string }
  | { type: "community"; id: string }
  | { type: "therapist"; id: string };

export type Db = Awaited<ReturnType<typeof getDb>>;

export { loadAuthzUser } from "@/lib/require-session";

// §8D — every rejection from the three referral functions RAISEs a stable
// ERRCODE; this is the one place that maps it to the user-facing wording
// CLAUDE.md's fail-closed rule requires. Never a blind retry, never a
// partial apply, never a client-side reimplementation of the rejected
// logic — the function already rolled its whole call back.
export function mapReferralError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "AHP01":
    case "AHP02":
      return "One of your choices is no longer available — pick again.";
    case "AHP03":
      return "Went to someone else.";
    case "AHP05":
      return "This offer has moved on — refresh to see where it stands.";
    case "AHP07":
      return "You've already extended this offer once.";
    default:
      return "Please try again.";
  }
}

export interface PostReferralInput {
  roleNeeded: (typeof homeCaseReferrals.$inferInsert)["roleNeeded"];
  specializationNeeded: (typeof homeCaseReferrals.$inferInsert)["specializationNeeded"];
  /** Required unless areaScope is 'city' — the patient's locality, a real
   * `area_level = 'locality'` row (Round 3 step D review finding 6: a
   * referral posted at a zone, not a locality, silently missed anyone
   * whose coverage was a locality inside that zone). Validated below,
   * not just trusted from the client. */
  areaId?: string;
  /** Required when areaScope is 'city' — the patient's city, a real
   * `area_level = 'city'` row. Round 3 step D: without this, a city-wide
   * post had no city to match against at all and matched every therapist
   * on the platform (review finding 4). */
  cityAreaId?: string;
  /** Review item #1 — 'city' means the patient is willing to travel
   * anywhere in their city for a clinic visit; areaId is then omitted
   * entirely rather than left as a stand-in "anywhere" area row.
   * Refused for a home visit (checked below and by the DB CHECK
   * home_case_referrals_area_scope_home_visit) — a therapist travelling
   * to the patient is inherently locality-bound, only the reverse can be
   * area-agnostic. */
  areaScope?: "locality" | "city";
  homeVisitRequired: boolean;
  urgency: "routine" | "urgent";
  urgencyReason?: string;
  additionalContext?: string;
  locationAddress?: string;
  patientSummary: string;
  consentAccepted: boolean;
  /** Round 2 — "I'd ask Raghav first," generalized: a circle the poster
   * owns, a community they belong to, or one named therapist (the
   * profile "Refer Patient" CTA). Encoded honestly — the poster chose
   * explicitly, this is not an algorithm. Disabled entirely for
   * urgency = 'urgent' — an urgent case held back for one person or
   * group is a patient-harm vector, not a feature; both the CHECK
   * constraint below and home_case_referrals_first_look_routine_only
   * enforce this twice, once in TypeScript and once structurally. */
  firstLookTarget?: FirstLookTarget;
  /** Step 7E — the poster's own choice, shown only alongside a First Look
   * target: "if nobody responds in the window, open this to the wider
   * matched network" (default on in the UI). Only meaningful when there
   * IS a target — with none, the referral already goes straight to the
   * full pool. Still overridden to `false` below for the locked-city
   * exception regardless of what's passed here; that server-side rule
   * was already the only real enforcement (schema.ts's own comment on
   * this column), this just gives the poster a say in the one case where
   * it was previously always left at its default. */
  expandToNetwork?: boolean;
}

/**
 * §8D2 — the consent checkbox is mandatory and un-prechecked; blocks
 * referral creation entirely rather than being recorded after the fact.
 * §8D — urgency_reason is required when urgency = 'urgent', admin-only,
 * never shown to the matched pool.
 */
export async function postReferralTx(db: Db, userId: string, input: PostReferralInput) {
  if (!input.consentAccepted) {
    throw new Error("Patient consent is required before posting a referral");
  }
  if (input.urgency === "urgent" && !input.urgencyReason?.trim()) {
    throw new Error("An urgency reason is required for urgent referrals");
  }
  const areaScope = input.areaScope ?? "locality";
  if (areaScope === "city" && input.homeVisitRequired) {
    throw new Error("A city-wide referral (no locality) is only available for a clinic visit, not a home visit");
  }
  const cityAreaId = await resolveReferralCityAreaId(db, {
    areaScope,
    areaId: input.areaId,
    cityAreaId: input.cityAreaId,
  });

  // Round 3 step E — city open-pool unlock. Direct/circle/community
  // referrals work in every city regardless (they never touch the open
  // pool); only a broadcast to the full matched pool needs the city to
  // actually be unlocked.
  const cityUnlocked = await isCityUnlocked(db, cityAreaId);
  if (input.urgency === "urgent" && input.firstLookTarget) {
    if (input.firstLookTarget.type !== "therapist") {
      throw new Error("First Look isn't available for urgent referrals — an urgent case can't wait on one circle or community");
    }
    if (cityUnlocked) {
      // The city's own pool is reachable, so "hold it for one person"
      // is exactly the patient-harm risk First Look was already refused
      // for — the locked-city exception below doesn't apply here.
      throw new Error("First Look isn't available for urgent referrals — an urgent case can't wait on one person");
    }
    // Else: allowed — Round 3 step E's "urgent direct offer to one named
    // therapist in a locked city" exception (no First Look window,
    // offered immediately, the normal 2h clock; see the insert below).
  } else if (!input.firstLookTarget && !cityUnlocked) {
    const [city] = await db.select({ name: areas.name }).from(areas).where(eq(areas.id, cityAreaId));
    throw new Error(
      `${city?.name ?? "This city"} isn't open for public referrals yet — refer directly to a therapist, a circle, or a community you trust instead, or help unlock it.`,
    );
  }

  const authzUser = await loadAuthzUser(db, userId);
  if (authzUser.accountType !== "therapist") {
    throw new Error("Only therapists can post referrals in the pilot");
  }

  // Round 2 step 6 (plan decision 1) — "waitlisted: no directory
  // listing, no matching, no referral posting." Directory and matching
  // both already require profile_status = 'active' (they select on it
  // directly), but postReferralTx takes its target criteria as explicit
  // input params rather than deriving them from the poster's own
  // profile, so nothing else here would have refused a draft/waitlisted
  // user — this is the one enforcement point that promise actually needs.
  const [poster] = await db.select({ profileStatus: users.profileStatus }).from(users).where(eq(users.id, userId));
  if (poster?.profileStatus !== "active") {
    throw new Error("Finish setting up your profile before posting a referral");
  }

  // Whichever kind of target the poster chose, this resolves to "who's in
  // it" — null means no target at all (the common case: full matched pool
  // immediately, same as always). A single-therapist target's "membership"
  // is trivially the one person named.
  let firstLookMemberIds: Set<string> | null = null;
  const target = input.firstLookTarget;
  if (target?.type === "circle") {
    const [circle] = await db
      .select({ id: circles.id })
      .from(circles)
      .where(and(eq(circles.id, target.id), eq(circles.ownerUserId, userId), isNull(circles.deletedAt)));
    if (!circle) throw new Error("Circle not found");

    const memberRows = await db
      .select({ therapistUserId: circleMembers.therapistUserId })
      .from(circleMembers)
      .where(eq(circleMembers.circleId, target.id));
    firstLookMemberIds = new Set(memberRows.map((r) => r.therapistUserId));
  } else if (target?.type === "community") {
    const [community] = await db
      .select({ id: communities.id })
      .from(communities)
      .where(and(eq(communities.id, target.id), eq(communities.status, "active"), isNull(communities.deletedAt)));
    if (!community) throw new Error("Community not found");

    const [membership] = await db
      .select({ userId: communityMembers.userId })
      .from(communityMembers)
      .where(and(eq(communityMembers.communityId, target.id), eq(communityMembers.userId, userId)));
    if (!membership) throw new Error("You're not a member of that community");

    const memberRows = await db
      .select({ userId: communityMembers.userId })
      .from(communityMembers)
      .where(eq(communityMembers.communityId, target.id));
    firstLookMemberIds = new Set(memberRows.map((r) => r.userId));
  } else if (target?.type === "therapist") {
    if (target.id === userId) throw new Error("You can't refer a patient to yourself");
    const [therapist] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, target.id), eq(users.accountType, "therapist"), isNull(users.deletedAt)));
    if (!therapist) throw new Error("Therapist not found");
    firstLookMemberIds = new Set([target.id]);
  }

  // Matched before the insert, not after: a First Look target only ever
  // narrows this pool (CLAUDE.md — matching reads structured columns
  // only), and a named therapist outside it must be refused up front
  // rather than posted to silently reach nobody.
  // The poster themselves can incidentally satisfy every matching
  // criterion (same role, same specialization, covers the same area) —
  // never notify them about their own referral.
  const matched = (
    await matchTherapistsForReferral(db, {
      roleNeeded: input.roleNeeded,
      specializationNeeded: input.specializationNeeded,
      areaId: areaScope === "city" ? null : input.areaId!,
      cityAreaId,
      homeVisitRequired: input.homeVisitRequired,
    })
  ).filter((t) => t.id !== userId);

  if (target?.type === "therapist" && !matched.some((t) => t.id === target.id)) {
    // Round 3 step D review fix — D1 added profile_status/verification_
    // stage to matching, so "not matched" now has a real, common cause
    // this message didn't use to cover: not yet verified. Left generic
    // rather than distinguishing the exact reason (a second diagnostic
    // query with no real benefit — the poster's next step is the same
    // either way: pick someone else, or post without First Look).
    throw new Error(
      "This therapist doesn't match this referral's role, specialization, area or visit type, isn't verified yet, or isn't taking referrals right now — change those details, or post it without First Look.",
    );
  }

  const [referral] = await db
    .insert(homeCaseReferrals)
    .values({
      postedByUserId: userId,
      postedByType: "therapist",
      roleNeeded: input.roleNeeded,
      specializationNeeded: input.specializationNeeded,
      areaId: areaScope === "city" ? null : input.areaId,
      areaScope,
      cityAreaId,
      matchingAlgorithmVersion: MATCHING_ALGORITHM_VERSION,
      homeVisitRequired: input.homeVisitRequired,
      urgency: input.urgency,
      urgencyReason: input.urgency === "urgent" ? input.urgencyReason : null,
      additionalContext: input.additionalContext,
      locationAddress: input.locationAddress,
      patientSummary: input.patientSummary,
      patientConsentRecordedAt: new Date(),
      consentTextVersion: String(CONSENT_TEXT_VERSION),
      initialCircleId: target?.type === "circle" ? target.id : null,
      firstLookCommunityId: target?.type === "community" ? target.id : null,
      firstLookTherapistId: target?.type === "therapist" ? target.id : null,
      // Round 3 step E — the urgent-direct-in-a-locked-city exception
      // above is a target with NO First Look window at all: offered
      // immediately, same as any other urgent referral, just to one
      // person instead of the (unreachable, locked) pool. Every other
      // targeted post keeps the normal 4h First Look window.
      circleFirstWindow: target && input.urgency === "routine" ? CIRCLE_FIRST_WINDOW : null,
      // Round 2 follow-up (0047) — computed via the same waking-hours
      // helper the routine offer window uses, so First Look pauses
      // overnight instead of burning through 9pm-1am with nobody awake
      // to see it.
      circleFirstOpensAt:
        target && input.urgency === "routine" ? sql`add_waking_time(now(), interval '4 hours')` : null,
      // Round 3 step E — a locked city's pool never gets the rest of the
      // matched pool once a First Look window (routine) or the
      // immediate offer (urgent-direct) passes; that overrides the
      // poster's own choice (Step 7E) unconditionally. Without a target,
      // there's no First Look step to expand past, so the poster's input
      // doesn't apply either — only a targeted, unlocked-city post
      // actually reads it.
      expandToNetwork: target && !cityUnlocked ? false : target ? (input.expandToNetwork ?? true) : true,
    })
    .returning();

  await db
    .update(homeCaseReferrals)
    .set({ matchedPoolSizeAtPost: matched.length })
    .where(eq(homeCaseReferrals.id, referral.id));

  await db.insert(referralEvents).values({ referralId: referral.id, eventType: "posted", actorUserId: userId });

  // First Look: only the matched therapists who are ALSO in the chosen
  // target (circle/community/one therapist) get a referral_interest row
  // now — the rest of the matched pool gets one later, when the
  // scheduler's openCircleFirstReferrals (referral-scheduler.ts) extends
  // it after circle_first_window. No target chosen (the common case)
  // behaves exactly as before: the whole matched pool, immediately.
  const initialRecipients = firstLookMemberIds ? matched.filter((t) => firstLookMemberIds!.has(t.id)) : matched;

  if (initialRecipients.length > 0) {
    await db
      .insert(referralInterest)
      .values(initialRecipients.map((t) => ({ referralId: referral.id, therapistUserId: t.id })));

    await db.insert(referralEvents).values({
      referralId: referral.id,
      eventType: "notification_dispatched",
      payload: { therapist_ids: initialRecipients.map((t) => t.id) },
    });

    // Review item #4 — a "Refer Patient" single-therapist target gets its
    // own always-on template (referral_first_look_direct), never the
    // configurable referral_posted_match: this is a personal ask from a
    // named colleague, not a generic pool match, and it shouldn't be
    // silenceable by the same toggle that mutes routine pool matches.
    // referral-notification-sender.ts sends it by email in parallel with
    // push, same as an urgent offer — iOS Safari without the PWA
    // installed gets nothing from push alone. initialRecipients has
    // exactly one member when target.type === "therapist" (that member
    // is target.id), so this applies to that one recipient, never more.
    const matchTemplate = target?.type === "therapist" ? "referral_first_look_direct" : "referral_posted_match";
    await db.insert(notificationOutbox).values(
      initialRecipients.map((t) => ({
        userId: t.id,
        channel: "push" as const,
        template: matchTemplate,
        payload: { referral_id: referral.id },
        dedupeKey: `posted:${referral.id}:${t.id}`,
      })),
    );
  }

  return { referralId: referral.id, matchedPoolSize: matched.length };
}

export interface PreviewMatchInput {
  roleNeeded: MatchCriteria["roleNeeded"] | "";
  specializationNeeded: MatchCriteria["specializationNeeded"] | "";
  homeVisitRequired: boolean | null;
  areaScope: "locality" | "city";
  areaId?: string;
  cityAreaId?: string;
  /** A chosen First Look "refer to this one therapist" target, if any —
   * reported back as targetMatches so the form can surface "doesn't
   * match" before submit rather than after (postReferralTx's own
   * rejection, mirrored here read-only). */
  targetTherapistId?: string;
}

/**
 * Round 3 step D — "N therapists match" live on the posting form, before
 * the referral exists. Deliberately tolerant of an incomplete draft
 * (returns a zero count rather than throwing) since the form calls this
 * as soon as role/specialization/visit type/location are all set, which
 * can still be an invalid combination the user hasn't finished fixing.
 */
export interface PreviewMatchResult {
  count: number;
  targetMatches: boolean | null;
  /** Round 3 step E — whether the patient's city has its open pool
   * unlocked. A no-target post the form is about to make would be
   * refused server-side when this is false; surfaced here so the form
   * can show the refusal (with the city's pledge progress and a way to
   * help) before the poster even tries to submit. */
  cityUnlocked: boolean;
  cityAreaId: string;
  cityName: string;
  /** Only meaningful (and only fetched) when cityUnlocked is false — the
   * refusal UI's "7 of 25 pledged" line, so the form never needs a
   * second round trip to show it. */
  cityPledgeCount: number | null;
}

export async function previewReferralMatch(
  db: Db,
  userId: string,
  input: PreviewMatchInput,
): Promise<PreviewMatchResult | null> {
  if (!input.roleNeeded || !input.specializationNeeded || input.homeVisitRequired === null) {
    return null;
  }

  let cityAreaId: string;
  try {
    cityAreaId = await resolveReferralCityAreaId(db, {
      areaScope: input.areaScope,
      areaId: input.areaId,
      cityAreaId: input.cityAreaId,
    });
  } catch {
    return null;
  }

  const [{ count, targetMatches }, cityUnlocked, [city]] = await Promise.all([
    countMatchesForReferral(
      db,
      {
        roleNeeded: input.roleNeeded,
        specializationNeeded: input.specializationNeeded,
        areaId: input.areaScope === "city" ? null : input.areaId!,
        cityAreaId,
        homeVisitRequired: input.homeVisitRequired,
      },
      userId,
      input.targetTherapistId,
    ),
    isCityUnlocked(db, cityAreaId),
    db.select({ name: areas.name }).from(areas).where(eq(areas.id, cityAreaId)),
  ]);

  const cityPledgeCount = cityUnlocked ? null : (await getCityProgress(db, cityAreaId)).pledgeCount;

  return { count, targetMatches, cityUnlocked, cityAreaId, cityName: city?.name ?? "This city", cityPledgeCount };
}

/**
 * §8D — "anyone in the matched pool can tap 'I'm interested' — this only
 * registers interest, reveals nothing." In the normal case that pool
 * already has a `referral_interest` row from `postReferralTx` (or, for a
 * circle-first referral, from `openCircleFirstReferrals` once the window
 * passes) — this function's `existing` branch is what runs. The insert
 * branch below exists only for a matched therapist somehow reaching this
 * referral without a pre-populated row (e.g. a future empty-pool zone
 * expansion), and MUST re-verify the same structured-matching criteria
 * `postReferralTx` used, plus the circle-first window, before creating
 * one — skipping that re-check let any verified therapist (either tier,
 * since Round 3 decision 1) who knew/reached a referral's id self-insert
 * as a shortlist candidate
 * for a case they were never matched to, bypassing both the matching
 * filter and circle-first gating entirely (found in review, 2026-09-21).
 */
export async function expressInterestTx(db: Db, userId: string, referralId: string) {
  const authzUser = await loadAuthzUser(db, userId);
  const decision = can(authzUser, { type: "claim_referral" });
  if (!decision.allowed) throw new Error(decision.reason);

  const [existing] = await db
    .select({ id: referralInterest.id, status: referralInterest.status })
    .from(referralInterest)
    .where(and(eq(referralInterest.referralId, referralId), eq(referralInterest.therapistUserId, userId)));

  if (existing) {
    if (existing.status === "pending") return { interestId: existing.id };
    if (existing.status === "missed") {
      throw new Error("Your offer window closed — use \"Still interested\" to let the poster know you're available again");
    }
    throw new Error("You've already responded to this referral");
  }

  const [referral] = await db
    .select({
      status: homeCaseReferrals.status,
      postedByUserId: homeCaseReferrals.postedByUserId,
      roleNeeded: homeCaseReferrals.roleNeeded,
      specializationNeeded: homeCaseReferrals.specializationNeeded,
      areaId: homeCaseReferrals.areaId,
      areaScope: homeCaseReferrals.areaScope,
      cityAreaId: homeCaseReferrals.cityAreaId,
      homeVisitRequired: homeCaseReferrals.homeVisitRequired,
      circleFirstWindow: homeCaseReferrals.circleFirstWindow,
      circleFirstOpenedAt: homeCaseReferrals.circleFirstOpenedAt,
    })
    .from(homeCaseReferrals)
    .where(eq(homeCaseReferrals.id, referralId));

  if (!referral || referral.status !== "open") {
    throw new Error("This referral isn't open to new interest");
  }
  if (referral.postedByUserId === userId) {
    throw new Error("You can't express interest in your own referral");
  }
  // First Look: nobody outside the initial recipients (who already have a
  // row from postReferralTx) may register interest until the scheduler
  // opens the window — a matched-but-not-in-the-target therapist has to
  // wait like the rest of the pool, not go around it via this path.
  // circleFirstWindow is set for every target kind (circle/community/one
  // therapist), so it's the one column to check here regardless of which.
  if (referral.circleFirstWindow && !referral.circleFirstOpenedAt) {
    throw new Error("This referral was offered to someone else first — check back soon");
  }
  // Round 3 step E — a referral posted in a locked city always has a
  // target (postReferralTx refuses a no-target post there), and the
  // designated recipient(s) already have their row from postReferralTx —
  // so reaching this insert-branch at all means this therapist wasn't
  // one of them. The urgent-direct case (no First Look window at all)
  // needs this check specifically, since its NULL circleFirstWindow
  // skips the "held back" check just above without it.
  if (referral.cityAreaId && !(await isCityUnlocked(db, referral.cityAreaId))) {
    throw new Error("This referral doesn't match your profile");
  }
  // areaId is nullable in the schema; NULL is only ever legitimate for a
  // 'city' scope referral (review item #1) — for a plain 'locality'
  // referral, a missing area means there's nothing to verify a location
  // match against, so treat it the same as "doesn't match."
  if (referral.areaScope === "locality" && !referral.areaId) {
    throw new Error("This referral doesn't match your profile");
  }

  const matched = await matchTherapistsForReferral(db, {
    roleNeeded: referral.roleNeeded,
    // specializationNeeded is NOT NULL in the DB (schema.ts); Drizzle's
    // partial-select inference just doesn't carry that through here.
    specializationNeeded: referral.specializationNeeded!,
    areaId: referral.areaScope === "city" ? null : referral.areaId,
    cityAreaId: referral.cityAreaId,
    homeVisitRequired: referral.homeVisitRequired,
  });
  if (!matched.some((t) => t.id === userId)) {
    throw new Error("This referral doesn't match your profile");
  }

  const [interest] = await db
    .insert(referralInterest)
    .values({ referralId, therapistUserId: userId })
    .returning();

  await db.insert(referralEvents).values({ referralId, eventType: "interest_expressed", actorUserId: userId });

  return { interestId: interest.id };
}

/**
 * Review item #2 / ARCHITECTURE_REVIEW.md §G2 — "a missed offer may
 * re-express interest on a repost" was decided but never actually wired
 * up: expressInterestTx's `existing` branch threw "You've already
 * responded" for a 'missed' row exactly like a genuine 'declined' one,
 * so a therapist who missed their offer window (hands on a patient, per
 * §G2's own reasoning) had no way back in even after the referral
 * reopened.
 *
 * Deliberately its own function, not a branch inside expressInterestTx:
 * the caller already knows definitively they were shortlisted and missed
 * (myInterest.status === 'missed' on the detail page), so this skips the
 * matching re-verification expressInterestTx does for a therapist who
 * might not actually be in the pool — a 'missed' row is proof they were.
 * Only valid while the referral is 'open' (no live round in progress);
 * once shortlisted again — with or without this therapist — a plain
 * 'missed' row sits inert, same as before.
 */
export async function reExpressInterestTx(db: Db, userId: string, referralId: string) {
  const [existing] = await db
    .select({ id: referralInterest.id, status: referralInterest.status })
    .from(referralInterest)
    .where(and(eq(referralInterest.referralId, referralId), eq(referralInterest.therapistUserId, userId)));

  if (!existing || existing.status !== "missed") {
    throw new Error("There's no missed offer on this referral to re-express interest in");
  }

  const [referral] = await db
    .select({ status: homeCaseReferrals.status, postedByUserId: homeCaseReferrals.postedByUserId })
    .from(homeCaseReferrals)
    .where(eq(homeCaseReferrals.id, referralId));

  if (!referral || referral.status !== "open") {
    throw new Error("This referral has moved on and can't take a renewed interest right now");
  }

  await db
    .update(referralInterest)
    .set({ status: "pending", respondedAt: null, updatedAt: new Date() })
    .where(eq(referralInterest.id, existing.id));

  await db.insert(referralEvents).values({ referralId, eventType: "re_expressed_interest", actorUserId: userId });

  await db.insert(notificationOutbox).values({
    userId: referral.postedByUserId,
    channel: "push",
    template: "referral_missed_therapist_available_again",
    payload: { referral_id: referralId, therapist_id: userId },
  });

  return { interestId: existing.id };
}

/**
 * §8D — the poster picks up to 2 finalists. Thin wrapper around a single
 * `SELECT shortlist_referral(...)`. Uses the raw postgres.js client
 * (db.$client) rather than drizzle's own `sql` tag — drizzle's tag
 * renders a raw JS array parameter as a parenthesized tuple ("($3)")
 * instead of binding it as a single UUID[] parameter, which this
 * function's signature requires.
 *
 * Both a bare JS array (`${therapistIds}`) and postgres.js's own
 * `sql.array(...)` helper need the driver's OID/type-introspection round
 * trip to serialize an array parameter correctly — and db.ts's Hyperdrive
 * client runs with `fetch_types: false` specifically to skip that round
 * trip (paid on every request, since the client can't be cached across
 * them). Without it, both paths silently fall back to a bare
 * comma-joined string — `22P02 malformed array literal` — reproduced
 * locally against the exact same client config that broke the first time
 * this ran over the real deployed Hyperdrive Worker (Phase 12's
 * load-test gate). A hand-built `{a,b}` literal bound as a plain string
 * parameter needs no type introspection at all — postgres.js always
 * binds a JS string correctly — so the `::uuid[]` cast happens entirely
 * in Postgres, independent of the driver's type resolution.
 */
export async function shortlistCandidatesTx(db: Db, posterId: string, referralId: string, therapistIds: string[]) {
  const therapistIdsLiteral = `{${therapistIds.join(",")}}`;
  try {
    const [row] = await db.$client<{ result: unknown }[]>`
      SELECT shortlist_referral(${referralId}, ${posterId}, ${therapistIdsLiteral}::uuid[]) AS result`;
    return row.result;
  } catch (error) {
    // `cause` preserves the real Postgres error (code, message) for
    // whoever's equipped to read it (e.g. the Phase 12 load-test route);
    // `.message` itself stays the safe, fixed wording every caller
    // already displays — this never changes what a user sees.
    throw new Error(mapReferralError(error), { cause: error });
  }
}

/** §8D — first to accept wins. Thin wrapper around a single `SELECT accept_referral(...)`. */
export async function acceptOfferTx(
  db: Db,
  userId: string,
  referralId: string,
  interestId: string,
  idempotencyKey: string,
) {
  const authzUser = await loadAuthzUser(db, userId);
  const decision = can(authzUser, { type: "claim_referral" });
  if (!decision.allowed) throw new Error(decision.reason);

  try {
    const [row] = await db.$client<{ result: unknown }[]>`
      SELECT accept_referral(${referralId}, ${interestId}, ${userId}, ${idempotencyKey}) AS result`;
    return row.result;
  } catch (error) {
    throw new Error(mapReferralError(error), { cause: error });
  }
}

/** [G2] An explicit "can't take this one" tap — a different fact from the
 * window closing unanswered ('missed'). A single `SELECT decline_offer(...)`
 * since Round 2 (0045): declining the last live offer reopens the
 * referral, which is a state transition and so takes the referral lock. */
export async function declineOfferTx(db: Db, userId: string, referralId: string, interestId: string) {
  try {
    const [row] = await db.$client<{ result: unknown }[]>`
      SELECT decline_offer(${referralId}, ${interestId}, ${userId}) AS result`;
    return row.result;
  } catch (error) {
    throw new Error(mapReferralError(error), { cause: error });
  }
}

/** Round 2 — the poster buys the live round more time, once per round
 * (+1h urgent, +6 waking hours routine). A single `SELECT extend_offer(...)`. */
export async function extendOfferTx(db: Db, posterId: string, referralId: string) {
  try {
    const [row] = await db.$client<{ result: unknown }[]>`
      SELECT extend_offer(${referralId}, ${posterId}) AS result`;
    return row.result;
  } catch (error) {
    throw new Error(mapReferralError(error), { cause: error });
  }
}

/** Who may load /app/referrals/[id] at all — poster, anyone in the interest
 * table, or any therapist for an open referral (network-activity feed). */
export function canViewReferralDetail(
  referral: { postedByUserId: string; status: string; inFirstLook?: boolean },
  viewerUserId: string,
  hasInterest: boolean,
): boolean {
  if (referral.postedByUserId === viewerUserId) return true;
  if (hasInterest) return true;
  // A referral still in its First Look window is visible only to its
  // targets (who already hold an interest row) — not to the whole network.
  if (referral.status === "open" && !referral.inFirstLook) return true;
  return false;
}

/** §8D2 + §8A3 — poster always sees their own summary; receiving therapists
 * only after shortlist/accept AND a verified tier (either
 * qualification_confirmed or credentials_verified, Round 3 decision 1)
 * via can(). */
export function canViewPatientSummaryOnReferral(
  authzUser: AuthzUser,
  isPoster: boolean,
  interestStatus: string | null | undefined,
): boolean {
  const relationshipAllows =
    isPoster || interestStatus === "shortlisted" || interestStatus === "accepted";
  if (!relationshipAllows) return false;
  if (isPoster) return true;
  return can(authzUser, { type: "view_patient_summary" }).allowed;
}
