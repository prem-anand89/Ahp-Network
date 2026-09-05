// §8D — the referral board's core write paths, taking `db` and the
// resolved `userId` as explicit parameters (same DI pattern as
// submitPracticeClaimTx in practice-claims.ts) specifically so they're
// testable against a real local Postgres without needing
// getCloudflareContext or a Supabase auth session. The "use server" file
// at src/app/app/referrals/actions.ts is a thin wrapper resolving auth and
// calling into these.

import { eq, and, isNull } from "drizzle-orm";
import { homeCaseReferrals, notificationOutbox, referralEvents, referralInterest } from "@/db/schema";
import { can, type AuthzUser } from "@/lib/authz";
import { loadAuthzUser } from "@/lib/require-session";
import { matchTherapistsForReferral } from "@/lib/referral-matching";
import { CONSENT_TEXT_VERSION } from "@/lib/copy";
import type { getDb } from "@/db/db";

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

  const authzUser = await loadAuthzUser(db, userId);
  if (authzUser.accountType !== "therapist") {
    throw new Error("Only therapists can post referrals in the pilot");
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

  if (matched.length > 0) {
    await db
      .insert(referralInterest)
      .values(matched.map((t) => ({ referralId: referral.id, therapistUserId: t.id })));

    await db.insert(referralEvents).values({
      referralId: referral.id,
      eventType: "notification_dispatched",
      payload: { therapist_ids: matched.map((t) => t.id) },
    });

    await db.insert(notificationOutbox).values(
      matched.map((t) => ({
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

/** §8D — "anyone in the matched pool can tap 'I'm interested' — this only registers interest, reveals nothing." */
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
 * function's signature requires; postgres.js's own tagged template binds
 * a JS array correctly, as proven in referral-concurrency.test.ts.
 */
export async function shortlistCandidatesTx(db: Db, posterId: string, referralId: string, therapistIds: string[]) {
  try {
    const [row] = await db.$client<{ result: unknown }[]>`
      SELECT shortlist_referral(${referralId}, ${posterId}, ${therapistIds}) AS result`;
    return row.result;
  } catch (error) {
    throw new Error(mapReferralError(error));
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
    throw new Error(mapReferralError(error));
  }
}

/** [G2] An explicit "can't take this one" tap — a different fact from the window closing unanswered ('missed'). */
export async function declineOfferTx(db: Db, userId: string, referralId: string, interestId: string) {
  const result = await db
    .update(referralInterest)
    .set({ status: "declined", respondedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(referralInterest.id, interestId),
        eq(referralInterest.referralId, referralId),
        eq(referralInterest.therapistUserId, userId),
        isNull(referralInterest.deletedAt),
      ),
    )
    .returning({ id: referralInterest.id });

  if (result.length === 0) {
    throw new Error("This offer is no longer open to respond to");
  }

  await db.insert(referralEvents).values({ referralId, eventType: "declined", actorUserId: userId });
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
