"use server";

// Therapist-facing practice creation and claims — plan §8C/§8C1. Lives
// under /app/*, never /admin/* (CLAUDE.md's route-segment split).

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { can } from "@/lib/authz";
import { practices, practiceUsers } from "@/db/schema";
import { autocompletePlaces, getPlaceDetails } from "@/lib/google-places";
import { normalizePracticeName, normalizePracticeAddress, findDuplicatePractice } from "@/lib/practice-dedupe";
import { submitPracticeClaimTx, type SubmitPracticeClaimInput } from "@/lib/practice-claims";
import { createPresignedUploadUrl } from "@/lib/r2-presign";
import { requireAuthedTherapist } from "@/lib/require-session";

interface SecretsEnv {
  GOOGLE_PLACES_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

export async function searchPlaceSuggestions(query: string, sessionToken: string) {
  const { env } = await getCloudflareContext({ async: true });
  return autocompletePlaces(env as unknown as SecretsEnv, query, sessionToken);
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
  const { db, authUser, profile } = await requireAuthedTherapist();

  const authzResult = can(
    {
      id: authUser.id,
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
    const { env } = await getCloudflareContext({ async: true });
    const details = await getPlaceDetails(
      env as unknown as SecretsEnv,
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
      createdByUserId: authUser.id,
      possibleDuplicateOf,
    })
    .returning({ id: practices.id });

  // §8C: "A therapist creating a practice automatically receives a
  // self-asserted works_at affiliation — never owns." Self-asserted
  // affiliations are immediately visible (§8C2), unlike a practice-added
  // affiliation which starts pending.
  await db.insert(practiceUsers).values({
    practiceId: practice.id,
    userId: authUser.id,
    accessRole: "staff",
    relationshipType: "works_at",
    consentStatus: "accepted",
    assertedBy: "self",
    isPublic: true,
  });

  return { id: practice.id, possibleDuplicateOf };
}

export async function requestClaimDocumentUploadUrl(contentType: string) {
  const { authUser } = await requireAuthedTherapist();
  const { env } = await getCloudflareContext({ async: true });
  const objectKey = `practice-claims/${authUser.id}/${crypto.randomUUID()}`;

  const url = await createPresignedUploadUrl(env as unknown as SecretsEnv, {
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
  const { db, authUser } = await requireAuthedTherapist();
  return submitPracticeClaimTx(db, { ...input, claimantUserId: authUser.id });
}
