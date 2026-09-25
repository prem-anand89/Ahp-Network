"use server";

// Round 2 step 6 (plan decisions 1 & 2) — admin pledge-threshold review
// and the two actions a human takes on it: unlock a city, create a
// community from a proposal that's reached PLEDGE_THRESHOLD.

import { revalidatePath } from "next/cache";
import { createCommunityFromProposalTx, unlockCityTx } from "@/lib/pledges";
import { requireAdminAccess } from "@/lib/require-admin-access";

export async function unlockCity(cityAreaId: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "manage_pledges" });
  await unlockCityTx(db, adminUserId, cityAreaId);
  revalidatePath("/admin/pledges");
}

export async function createCommunityFromProposal(proposalId: string) {
  const { db, adminUserId } = await requireAdminAccess({ type: "create_community" });
  await createCommunityFromProposalTx(db, adminUserId, proposalId);
  revalidatePath("/admin/pledges");
  revalidatePath("/app/communities");
}
