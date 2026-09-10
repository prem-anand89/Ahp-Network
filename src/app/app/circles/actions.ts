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
  findTherapistIdBySlug,
  removeCircleMember,
  renameCircle,
} from "@/lib/circles";

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

/** Accepts the therapist's public profile slug (what's actually visible on
 * a /pt/[slug] page) rather than a raw user id — that's what an owner can
 * copy/paste or type when adding someone to a Circle. */
export async function addCircleMemberBySlugAction(circleId: string, slug: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  const therapistUserId = await findTherapistIdBySlug(db, slug.trim());
  if (!therapistUserId) throw new Error("No therapist found with that profile link");
  await addCircleMember(db, userId, circleId, therapistUserId);
  revalidatePath(`/app/circles/${circleId}`);
}

export async function removeCircleMemberAction(circleId: string, therapistUserId: string) {
  const userId = await requireAuthUserId();
  const db = await getDb();
  await removeCircleMember(db, userId, circleId, therapistUserId);
  revalidatePath(`/app/circles/${circleId}`);
}
