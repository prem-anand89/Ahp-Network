"use server";

// Therapist-facing practice creation and claims — plan §8C/§8C1. Lives
// under /app/*, never /admin/* (CLAUDE.md's route-segment split).

import { and, count, eq, gte } from "drizzle-orm";
import { can } from "@/lib/authz";
import { practices, practiceUsers, placeSearchEvents } from "@/db/schema";
import { autocompletePlaces, getPlaceDetails } from "@/lib/google-places";
import { normalizePracticeName, normalizePracticeAddress, findDuplicatePractice } from "@/lib/practice-dedupe";
import { submitPracticeClaimTx, type SubmitPracticeClaimInput } from "@/lib/practice-claims";
import { createPresignedUploadUrl } from "@/lib/r2-presign";
import { requireAuthedTherapist } from "@/lib/require-session";
import { getRuntimeEnv } from "@/lib/runtime-env";

// Phase 1 step 15's admin-integrity audit: this file's four exports are
// live, callable server actions whether or not any UI imports them, and
// as of this audit nothing does — zero review-through-use. Each below now
// calls can(...)/requireAuthedTherapist() first; requestClaimDocumentUploadUrl
// already scoped its R2 key to the caller's own user id and constrains
// content-type through the same allowlist createPresignedUploadUrl uses
// for credential documents (kind: "credential_document"). Size can't be
// capped at presign time (SigV4 query signing has no max-content-length
// constraint without a POST policy) — that's enforced client-side via
// validateUpload() before the PUT, same as the credential upload form;
// there's no client yet since the claim-upload UI ships in Phase 3, so
// this is a real gap until then, not a silent one.

// searchPlaceSuggestions previously had NO gate at all — a fully open
// relay for a paid Google API, callable by anyone including a logged-out
// visitor. Now requires auth and a per-user rate limit (same row-counting
// pattern as invites.ts's WEEKLY_RATE_LIMIT).
const PLACE_SEARCH_RATE_LIMIT = 60;

export class PlaceSearchRateLimitError extends Error {
  constructor() {
    super(`No more than ${PLACE_SEARCH_RATE_LIMIT} place searches per person per hour`);
    this.name = "PlaceSearchRateLimitError";
  }
}

interface SecretsEnv {
  GOOGLE_PLACES_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

export async function searchPlaceSuggestions(query: string, sessionToken: string) {
  const { db, userId } = await requireAuthedTherapist();

  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [{ recent }] = await db
    .select({ recent: count() })
    .from(placeSearchEvents)
    .where(and(eq(placeSearchEvents.userId, userId), gte(placeSearchEvents.createdAt, since)));
  if (recent >= PLACE_SEARCH_RATE_LIMIT) throw new PlaceSearchRateLimitError();

  await db.insert(placeSearchEvents).values({ userId });

  const env = await getRuntimeEnv<SecretsEnv>();
  return autocompletePlaces(env, query, sessionToken);
}

export interface CreatePracticeInput {
  name: string;
  type: "clinic" | "hospital_department" | "home_care_agency" | "wellness_center" | "other";
  placeId?: string;
  sessionToken?: string;
  /** Fallback when Places has no listing for this place (plan §8C). */
  manualAddress?: string;
}

export async function createPractice(input: CreatePracticeInput) {
  const { db, userId, profile } = await requireAuthedTherapist();

  const authzResult = can(
    {
      id: userId,
      accountType: profile.accountType,
      verificationStage: profile.verificationStage,
      adminRoles: [],
      contactDisclosureHoldUntil: null,
    },
    { type: "create_practice" },
  );
  if (!authzResult.allowed) throw new Error(authzResult.reason);

  let googlePlaceId: string | null = null;
  let formattedAddress: string;
  let latitude: number | null = null;
  let longitude: number | null = null;

  if (input.placeId && input.sessionToken) {
    const env = await getRuntimeEnv<SecretsEnv>();
    const details = await getPlaceDetails(
      env,
      input.placeId,
      input.sessionToken,
    );
    googlePlaceId = details.placeId;
    formattedAddress = details.formattedAddress;
    latitude = details.latitude;
    longitude = details.longitude;
  } else if (input.manualAddress) {
    formattedAddress = input.manualAddress;
  } else {
    throw new Error("Either a Places selection or a manual address is required");
  }

  const normalizedName = normalizePracticeName(input.name);
  const normalizedAddress = normalizePracticeAddress(formattedAddress);

  // Surfaced as a merge candidate in the admin queue — NEVER auto-merged
  // (plan §8C).
  const possibleDuplicateOf = await findDuplicatePractice(db, {
    googlePlaceId,
    normalizedName,
    normalizedAddress,
  });

  const [practice] = await db
    .insert(practices)
    .values({
      name: input.name,
      type: input.type,
      googlePlaceId,
      formattedAddress,
      latitude,
      longitude,
      normalizedName,
      normalizedAddress,
      createdByUserId: userId,
      possibleDuplicateOf,
    })
    .returning({ id: practices.id });

  // §8C: "A therapist creating a practice automatically receives a
  // self-asserted works_at affiliation — never owns." Self-asserted
  // affiliations are immediately visible (§8C2), unlike a practice-added
  // affiliation which starts pending.
  await db.insert(practiceUsers).values({
    practiceId: practice.id,
    userId: userId,
    accessRole: "staff",
    relationshipType: "works_at",
    consentStatus: "accepted",
    assertedBy: "self",
    isPublic: true,
  });

  return { id: practice.id, possibleDuplicateOf };
}

export async function requestClaimDocumentUploadUrl(contentType: string) {
  const { userId, profile } = await requireAuthedTherapist();
  const authzResult = can(
    {
      id: userId,
      accountType: profile.accountType,
      verificationStage: profile.verificationStage,
      adminRoles: [],
      contactDisclosureHoldUntil: null,
    },
    { type: "submit_practice_claim" },
  );
  if (!authzResult.allowed) throw new Error(authzResult.reason);

  const env = await getRuntimeEnv<SecretsEnv>();
  const objectKey = `practice-claims/${userId}/${crypto.randomUUID()}`;

  const url = await createPresignedUploadUrl(env, {
    kind: "credential_document", // same private bucket, whitelist, magic-byte rules
    contentType,
    objectKey,
  });

  return { url, objectKey };
}

/**
 * §8C1's contested-claim handling — the transaction itself lives in
 * src/lib/practice-claims.ts so it's directly testable against a real
 * Postgres transaction (see practice-claims.test.ts). This wrapper only
 * resolves who's calling.
 */
export async function submitPracticeClaim(input: Omit<SubmitPracticeClaimInput, "claimantUserId">) {
  const { db, userId, profile } = await requireAuthedTherapist();
  const authzResult = can(
    {
      id: userId,
      accountType: profile.accountType,
      verificationStage: profile.verificationStage,
      adminRoles: [],
      contactDisclosureHoldUntil: null,
    },
    { type: "submit_practice_claim" },
  );
  if (!authzResult.allowed) throw new Error(authzResult.reason);

  return submitPracticeClaimTx(db, { ...input, claimantUserId: userId });
}
