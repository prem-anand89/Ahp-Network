"use server";

// Round 2 step 6 (plan decisions 1 & 2) — therapist-facing pledge actions.
// Thin wrappers over src/lib/pledges.ts, same DI-testable pattern as the
// referral board's actions.ts.

import {
  listOpenCommunityProposals,
  pledgeForCityTx,
  pledgeForCommunityTx,
  proposeCommunityTx,
} from "@/lib/pledges";
import { requireAuthedTherapist } from "@/lib/require-session";

// PLEDGE_THRESHOLD is NOT re-exported here — a "use server" file may
// only export async functions and types (place-search-errors.ts
// documents the exact same constraint for the same reason); components
// that need the number for display import it from "@/lib/pledge-options"
// directly instead.

export async function pledgeForCity(city: string) {
  const { db, userId } = await requireAuthedTherapist();
  return pledgeForCityTx(db, userId, city);
}

export async function proposeCommunity(name: string, description: string | undefined) {
  const { db, userId } = await requireAuthedTherapist();
  return proposeCommunityTx(db, userId, name, description);
}

export async function pledgeForCommunity(proposalId: string) {
  const { db, userId } = await requireAuthedTherapist();
  return pledgeForCommunityTx(db, userId, proposalId);
}

export async function getCommunityProposals() {
  const { db } = await requireAuthedTherapist();
  return listOpenCommunityProposals(db);
}
