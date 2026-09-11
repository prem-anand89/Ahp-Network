"use server";

// Profile Card addendum — the one-tap availability toggle. Thin wrapper
// following the house pattern: authz check + delegate to a db-injected,
// independently testable function in src/lib/availability.ts.

import { revalidatePath } from "next/cache";
import { requireEditOwnProfile } from "@/lib/require-session";
import { setAvailabilityTx } from "@/lib/availability";

export async function setAvailabilityAction(available: boolean): Promise<void> {
  const { userId, db } = await requireEditOwnProfile();
  await setAvailabilityTx(db, userId, available);
  revalidatePath("/app/dashboard");
}
