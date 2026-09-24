"use server";

// Phase 2 — the profile editor's server actions. Thin wrappers over
// src/lib/profile-details.ts, same DI-testable pattern as onboarding's
// actions.ts.

import { revalidatePath } from "next/cache";
import { requireEditOwnProfile } from "@/lib/require-session";
import { updateProfileDetailsTx, type ProfileDetailsInput } from "@/lib/profile-details";
import { replaceCoverageTx, type CoverageRow } from "@/lib/coverage";
import { createPresignedUploadUrl } from "@/lib/r2-presign";
import { publicPhotoUrl } from "@/lib/r2";
import { getRuntimeEnv } from "@/lib/runtime-env";

// R2 access-key secrets are Workers Secrets — see verification/actions.ts
// (the credential-upload path) for why this interface exists rather than
// reading process.env/CloudflareEnv directly.
interface R2SecretsEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

export async function requestProfilePhotoUploadUrl(contentType: string) {
  const { userId } = await requireEditOwnProfile();
  const env = await getRuntimeEnv<R2SecretsEnv>();
  // Scoped to the caller's own user id, same discipline as the credential
  // and practice-claim upload paths — never a caller-supplied path.
  const objectKey = `photos/${userId}/${crypto.randomUUID()}`;

  const url = await createPresignedUploadUrl(env, { kind: "photo", contentType, objectKey });
  return { url, objectKey };
}

export type SaveProfileDetailsInput = Omit<ProfileDetailsInput, "photoUrl"> & {
  /** The objectKey returned by requestProfilePhotoUploadUrl, only when a
   * new photo was actually uploaded this save. */
  photoObjectKey?: string;
};

export async function saveProfileDetails(input: SaveProfileDetailsInput) {
  const { db, userId } = await requireEditOwnProfile();

  const { photoObjectKey, ...rest } = input;
  const photoUrl = photoObjectKey
    ? publicPhotoUrl(process.env.NEXT_PUBLIC_PHOTOS_BASE_URL ?? "", photoObjectKey)
    : undefined;

  await updateProfileDetailsTx(db, userId, { ...rest, photoUrl });

  revalidatePath("/app/profile");
  revalidatePath("/app/dashboard");
}

// Round 3 step C — "Where you work." Previously only onboarding wrote
// home_visit_areas; this is the one other write path, reusing the same
// two-tier, multi-city AreaCoveragePicker.
export async function saveMyCoverage(baseAreaId: string, coverage: CoverageRow[]) {
  const { db, userId } = await requireEditOwnProfile();
  await replaceCoverageTx(db, userId, baseAreaId, coverage);
  revalidatePath("/app/profile");
  revalidatePath("/app/dashboard");
}
