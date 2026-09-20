"use server";

// §8D — the referral board's therapist-facing server actions. Thin
// wrappers: resolve the authenticated user and getDb(), then call into
// src/lib/referral-actions.ts's testable, DB-injected functions. Never
// re-implements the three PL/pgSQL transactions as client-side statements
// — shortlistCandidates/acceptOffer are single `SELECT fn(...)` calls.

import { getDb } from "@/db/db";
import {
  acceptOfferTx,
  declineOfferTx,
  expressInterestTx,
  postReferralTx,
  shortlistCandidatesTx,
  type PostReferralInput,
} from "@/lib/referral-actions";
import { reportOutcomeTx, sendNudgeTx, type ReportReferralOutcomeInput } from "@/lib/referral-outcomes";
import { writeCaseBriefTx, type CaseBriefInput } from "@/lib/case-brief";
import { writePeerNoteTx, editPeerNoteTx, hidePeerNoteTx } from "@/lib/peer-notes";
import { requireAuthUserId } from "@/lib/require-session";

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

export async function reportOutcome(referralId: string, input: ReportReferralOutcomeInput) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return reportOutcomeTx(db, userId, referralId, input);
}

export async function sendNudge(referralId: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return sendNudgeTx(db, userId, referralId);
}

export async function writeCaseBrief(referralId: string, input: CaseBriefInput) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return writeCaseBriefTx(db, userId, referralId, input);
}

export async function writePeerNote(referralId: string, body: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return writePeerNoteTx(db, userId, referralId, body);
}

export async function editPeerNote(noteId: string, body: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return editPeerNoteTx(db, userId, noteId, body);
}

export async function hidePeerNote(noteId: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return hidePeerNoteTx(db, userId, noteId);
}
