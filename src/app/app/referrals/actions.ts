"use server";

// §8D — the referral board's therapist-facing server actions. Thin
// wrappers: resolve the authenticated user and getDb(), then call into
// src/lib/referral-actions.ts's testable, DB-injected functions. Never
// re-implements the three PL/pgSQL transactions as client-side statements
// — shortlistCandidates/acceptOffer are single `SELECT fn(...)` calls.

import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import {
  acceptOfferTx,
  declineOfferTx,
  expressInterestTx,
  postReferralTx,
  shortlistCandidatesTx,
  type PostReferralInput,
} from "@/lib/referral-actions";

async function requireAuthUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

export async function postReferral(input: PostReferralInput) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return postReferralTx(db, userId, input);
}

export async function expressInterest(referralId: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return expressInterestTx(db, userId, referralId);
}

export async function shortlistCandidates(referralId: string, therapistIds: string[]) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return shortlistCandidatesTx(db, userId, referralId, therapistIds);
}

export async function acceptOffer(referralId: string, interestId: string, idempotencyKey: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return acceptOfferTx(db, userId, referralId, interestId, idempotencyKey);
}

export async function declineOffer(referralId: string, interestId: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return declineOfferTx(db, userId, referralId, interestId);
}
