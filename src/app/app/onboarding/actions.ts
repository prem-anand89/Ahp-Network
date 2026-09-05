"use server";

// §10C — the onboarding step-2/2.5 server actions. Thin wrappers over
// src/lib/onboarding.ts, following the same DI-testable pattern as the
// referral board's actions.ts.

import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import {
  completeProfileStep2Tx,
  getLocalityContext,
  recordOnboardingMoment,
  type ProfileStep2Input,
} from "@/lib/onboarding";

async function requireAuthUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

export async function submitProfileStep2(input: ProfileStep2Input) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  await completeProfileStep2Tx(db, userId, input);
  await recordOnboardingMoment(db, userId, "profile_preview_shown");
  return getLocalityContext(db, input.areaId);
}

export async function markLocalityContextShown() {
  const userId = await requireAuthUserId();
  const db = await getDb();
  await recordOnboardingMoment(db, userId, "locality_context_shown");
}
