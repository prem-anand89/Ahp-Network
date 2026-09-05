"use server";

// §10C — the onboarding step-2/2.5 server actions. Thin wrappers over
// src/lib/onboarding.ts, following the same DI-testable pattern as the
// referral board's actions.ts.

import {
  completeProfileStep2Tx,
  getLocalityContext,
  recordOnboardingMoment,
  type ProfileStep2Input,
} from "@/lib/onboarding";
import { requireEditOwnProfile } from "@/lib/require-session";

export async function submitProfileStep2(input: ProfileStep2Input) {
  const { userId, db } = await requireEditOwnProfile();
  await completeProfileStep2Tx(db, userId, input);
  await recordOnboardingMoment(db, userId, "profile_preview_shown");
  return getLocalityContext(db, input.areaId);
}

export async function markLocalityContextShown() {
  const { userId, db } = await requireEditOwnProfile();
  await recordOnboardingMoment(db, userId, "locality_context_shown");
}
