"use server";

// Therapist-facing practice creation and claims — plan §8C/§8C1. Lives
// under /app/*, never /admin/* (CLAUDE.md's route-segment split).

import { and, eq, gte, isNull, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { can } from "@/lib/authz";
import { practices, practiceUsers, placeSearchEvents } from "@/db/schema";
import { autocompletePlaces, getPlaceDetails } from "@/lib/google-places";
import { normalizePracticeName, normalizePracticeAddress, findDuplicatePractice } from "@/lib/practice-dedupe";
import { submitPracticeClaimTx, type SubmitPracticeClaimInput } from "@/lib/practice-claims";
import { updatePracticeTx, type PracticeEditInput } from "@/lib/practice-edit";
import {
  invitePracticeMemberByEmail,
  removePracticeMember,
  requestPracticeMembership,
  respondToPracticeInvite,
  respondToPracticeRequest,
} from "@/lib/practice-consent";
import { createPresignedUploadUrl } from "@/lib/r2-presign";
import { requireAuthedTherapist } from "@/lib/require-session";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { PLACE_SEARCH_RATE_LIMIT, PlaceSearchRateLimitError } from "@/lib/place-search-errors";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "practice"
  );
}

/** Matches practices_active_slug's scope exactly — unique among
 * non-deleted rows, same pattern as onboarding.ts's generateUniqueSlug
 * for users. */
async function generateUniquePracticeSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await db
      .select({ id: practices.id })
      .from(practices)
      .where(and(eq(practices.slug, candidate), isNull(practices.deletedAt)));
    if (!existing) return candidate;
  }
}

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
// pattern as invites.ts's WEEKLY_RATE_LIMIT). PlaceSearchRateLimitError
// itself lives in lib/place-search-errors.ts, not here — a "use server"
// file may only export async functions (and types, which erase); a class
// export broke the build the moment a client component actually imported
// from this file (see that file's header for the full story).

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
  /** Round 3 step C — the practice's registry locality (areas.id), kept
   * separate from the Google-derived formattedAddress/lat/long above: one
   * is the raw geocoded address, the other is where the practice sits in
   * the national areas tree (referral matching, directory area filters). */
  areaId?: string;
  /** Step 7C UX improvements — asked at the end of the create form.
   * Doesn't gate anything server-side (claiming still needs the existing
   * documentation-based flow, §8C); it only changes where the form sends
   * the poster next. */
  isOwnerOrManager?: boolean;
  websiteUrl?: string;
  phone?: string;
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
  const slug = await generateUniquePracticeSlug(db, input.name);

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
      slug,
      googlePlaceId,
      formattedAddress,
      latitude,
      longitude,
      normalizedName,
      normalizedAddress,
      areaId: input.areaId ?? null,
      createdByUserId: userId,
      possibleDuplicateOf,
      websiteUrl: input.websiteUrl || undefined,
      phone: input.phone || undefined,
    })
    .returning({ id: practices.id, slug: practices.slug });

  // §8C: "A therapist creating a practice automatically receives a
  // self-asserted works_at affiliation — never owns." Self-asserted
  // affiliations are immediately visible (§8C2), unlike a practice-added
  // affiliation which starts pending.
  await db.insert(practiceUsers).values({
    practiceId: practice.id,
    userId: userId,
    accessRole: "staff",
    relationshipType: "works_at",
    status: "active",
    assertedBy: "self",
    isPublic: true,
  });

  revalidatePath("/app/practices");

  return { id: practice.id, slug: practice.slug, possibleDuplicateOf };
}

/** Logo/cover images use the same public "photo" upload kind as profile
 * photos (public bucket, same magic-byte/size rules) — a separate upload
 * kind isn't warranted for what's the same class of asset with a
 * different object-key prefix. */
export async function requestPracticeImageUploadUrl(contentType: string) {
  const { userId } = await requireAuthedTherapist();
  const env = await getRuntimeEnv<SecretsEnv>();
  const objectKey = `practice-photos/${userId}/${crypto.randomUUID()}`;

  const url = await createPresignedUploadUrl(env, { kind: "photo", contentType, objectKey });
  return { url, objectKey };
}

export type SavePracticeDetailsInput = Omit<PracticeEditInput, "logoUrl" | "coverImageUrl"> & {
  logoObjectKey?: string;
  coverImageObjectKey?: string;
};

export async function savePracticeDetails(practiceId: string, input: SavePracticeDetailsInput) {
  const { db, userId } = await requireAuthedTherapist();
  const photosBaseUrl = process.env.NEXT_PUBLIC_PHOTOS_BASE_URL ?? "";

  const { logoObjectKey, coverImageObjectKey, ...rest } = input;
  const logoUrl = logoObjectKey ? `${photosBaseUrl.replace(/\/+$/, "")}/${logoObjectKey}` : undefined;
  const coverImageUrl = coverImageObjectKey
    ? `${photosBaseUrl.replace(/\/+$/, "")}/${coverImageObjectKey}`
    : undefined;

  await updatePracticeTx(db, practiceId, userId, { ...rest, logoUrl, coverImageUrl });

  revalidatePath(`/app/practices/${practiceId}/edit`);
  revalidatePath("/app/practices");
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

// Round 2 step 3 — practice 2-way consent. The transaction logic itself
// lives in src/lib/practice-consent.ts (directly testable against a real
// Postgres, same split as submitPracticeClaim above); these wrappers only
// resolve who's calling and revalidate the pages that show the result.

export async function invitePracticeMember(
  practiceId: string,
  inviteeEmail: string,
  accessRole: "manager" | "staff",
) {
  const { db, userId } = await requireAuthedTherapist();
  await invitePracticeMemberByEmail(db, { practiceId, inviterUserId: userId, inviteeEmail, accessRole });
  revalidatePath(`/app/practices/${practiceId}/edit`);
}

export async function requestToJoinPractice(practiceId: string) {
  const { db, userId } = await requireAuthedTherapist();
  await requestPracticeMembership(db, { practiceId, requesterUserId: userId });
  revalidatePath("/app/practices");
  revalidatePath(`/clinic/${practiceId}`);
}

export async function respondToInvite(practiceId: string, accept: boolean) {
  const { db, userId } = await requireAuthedTherapist();
  await respondToPracticeInvite(db, { practiceId, therapistUserId: userId, accept });
  revalidatePath("/app/practices");
}

export async function respondToJoinRequest(practiceId: string, requesterUserId: string, accept: boolean) {
  const { db, userId } = await requireAuthedTherapist();
  await respondToPracticeRequest(db, { practiceId, requesterUserId, responderUserId: userId, accept });
  revalidatePath(`/app/practices/${practiceId}/edit`);
}

export async function removeTeamMember(practiceId: string, targetUserId: string) {
  const { db, userId } = await requireAuthedTherapist();
  await removePracticeMember(db, { practiceId, actingUserId: userId, targetUserId });
  revalidatePath(`/app/practices/${practiceId}/edit`);
  revalidatePath("/app/practices");
}
