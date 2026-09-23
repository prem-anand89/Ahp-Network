// §8D — the referral board's core write paths, taking `db` and the
// resolved `userId` as explicit parameters (same DI pattern as
// submitPracticeClaimTx in practice-claims.ts) specifically so they're
// testable against a real local Postgres without needing
// getCloudflareContext or a Supabase auth session. The "use server" file
// at src/app/app/referrals/actions.ts is a thin wrapper resolving auth and
// calling into these.

import { eq, and, isNull } from "drizzle-orm";
import {
  circleMembers,
  circles,
  communityMembers,
  homeCaseReferrals,
  notificationOutbox,
  referralEvents,
  referralInterest,
  users,
} from "@/db/schema";
import { can, type AuthzUser } from "@/lib/authz";
import { loadAuthzUser } from "@/lib/require-session";
import { matchTherapistsForReferral } from "@/lib/referral-matching";
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
  areaId: string;
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
  if (input.firstLookTarget && input.urgency === "urgent") {
    throw new Error("First Look isn't available for urgent referrals — an urgent case can't wait on one person or group");
  }

  const authzUser = await loadAuthzUser(db, userId);
  if (authzUser.accountType !== "therapist") {
    throw new Error("Only therapists can post referrals in the pilot");
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

  const [referral] = await db
    .insert(homeCaseReferrals)
    .values({
      postedByUserId: userId,
      postedByType: "therapist",
      roleNeeded: input.roleNeeded,
      specializationNeeded: input.specializationNeeded,
      areaId: input.areaId,
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
      circleFirstWindow: target ? CIRCLE_FIRST_WINDOW : null,
    })
    .returning();

  // The poster themselves can incidentally satisfy every matching
  // criterion (same role, same specialization, covers the same area) —
  // never notify them about their own referral.
  const matched = (
    await matchTherapistsForReferral(db, {
      roleNeeded: input.roleNeeded,
      specializationNeeded: input.specializationNeeded,
      areaId: input.areaId,
      homeVisitRequired: input.homeVisitRequired,
    })
  ).filter((t) => t.id !== userId);

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

    await db.insert(notificationOutbox).values(
      initialRecipients.map((t) => ({
        userId: t.id,
        channel: "push" as const,
        template: "referral_posted_match",
        payload: { referral_id: referral.id },
        dedupeKey: `posted:${referral.id}:${t.id}`,
      })),
    );
  }

  return { referralId: referral.id, matchedPoolSize: matched.length };
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
 * one — skipping that re-check let any credentials_verified therapist
 * who knew/reached a referral's id self-insert as a shortlist candidate
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
    throw new Error("You've already responded to this referral");
  }

  const [referral] = await db
    .select({
      status: homeCaseReferrals.status,
      postedByUserId: homeCaseReferrals.postedByUserId,
      roleNeeded: homeCaseReferrals.roleNeeded,
      specializationNeeded: homeCaseReferrals.specializationNeeded,
      areaId: homeCaseReferrals.areaId,
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
  // areaId is nullable in the schema, though postReferralTx always sets
  // it; with no area there's nothing to verify a location match against,
  // so treat it the same as "doesn't match."
  if (!referral.areaId) {
    throw new Error("This referral doesn't match your profile");
  }

  const matched = await matchTherapistsForReferral(db, {
    roleNeeded: referral.roleNeeded,
    // specializationNeeded is NOT NULL in the DB (schema.ts); Drizzle's
    // partial-select inference just doesn't carry that through here.
    specializationNeeded: referral.specializationNeeded!,
    areaId: referral.areaId,
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
  referral: { postedByUserId: string; status: string },
  viewerUserId: string,
  hasInterest: boolean,
): boolean {
  if (referral.postedByUserId === viewerUserId) return true;
  if (hasInterest) return true;
  if (referral.status === "open") return true;
  return false;
}

/** §8D2 + §8A3 — poster always sees their own summary; receiving therapists
 * only after shortlist/accept AND credentials_verified via can(). */
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
