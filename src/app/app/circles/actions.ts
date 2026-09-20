"use server";

// §8E2 — Circles' server actions. No authz tier beyond "signed in": a
// Circle is the owner's own private list, and every mutation in
// src/lib/circles.ts re-checks ownership at the query level regardless of
// what the caller passes, so there is no separate authz.can() check here
// to duplicate that.

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/db";
import { requireAuthUserId } from "@/lib/require-session";
import {
  addCircleMember,
  createCircle,
  deleteCircle,
  removeCircleMember,
  renameCircle,
} from "@/lib/circles";
import { searchTherapistsByName, type TherapistSearchResult } from "@/lib/directory";

export async function createCircleAction(name: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  const circle = await createCircle(db, userId, name);
  revalidatePath("/app/circles");
  return circle;
}

export async function renameCircleAction(circleId: string, name: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  await renameCircle(db, userId, circleId, name);
  revalidatePath("/app/circles");
}

export async function deleteCircleAction(circleId: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  await deleteCircle(db, userId, circleId);
  revalidatePath("/app/circles");
}

/** Phase 5 — replaces "type the person's URL slug by hand." Name search
 * over the same eligible-therapist set the public directory uses
 * (searchTherapistsByName, directory.ts), so an owner finds who they mean
 * by typing rather than knowing and pasting a URL. */
export async function searchTherapistsForCircleAction(query: string): Promise<TherapistSearchResult[]> {
  const userId = await requireAuthUserId();
  const db = await getDb();
  return searchTherapistsByName(db, query, userId);
}

export async function addCircleMemberByIdAction(circleId: string, therapistUserId: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  await addCircleMember(db, userId, circleId, therapistUserId);
  revalidatePath(`/app/circles/${circleId}`);
}

export async function removeCircleMemberAction(circleId: string, therapistUserId: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  await removeCircleMember(db, userId, circleId, therapistUserId);
  revalidatePath(`/app/circles/${circleId}`);
}
