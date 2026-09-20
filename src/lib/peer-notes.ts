// Phase 5 — peer notes. A "worked-together note," not an opinion: only a
// therapist who has actually completed a referral with the subject may
// write one, and referral_id NOT NULL is the mechanism that makes that
// true by construction. Same DI-testable pattern as case-brief.ts/
// referral-outcomes.ts.
//
// Never a count anywhere this is displayed — a visible number invites
// exactly the comparison §1A bans everywhere else on this product. At
// most two shown per profile by recency (listPeerNotesForProfile
// enforces the cap so no caller has to remember to).

import { and, desc, eq, isNull } from "drizzle-orm";
import { homeCaseReferrals, peerNotes, referralInterest, users } from "@/db/schema";
import { can } from "@/lib/authz";
import { loadAuthzUser } from "@/lib/require-session";
import type { getDb } from "@/db/db";

export type Db = Awaited<ReturnType<typeof getDb>>;

const MAX_BODY_LENGTH = 240;
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_NOTES_SHOWN_PER_PROFILE = 2;

type AuthorRelationship = "poster" | "accepter" | "none";

/** Never trusts a client-supplied subject id — the subject is always the
 * *other* party on the same referral, derived here from who the caller
 * actually is. */
async function resolveRelationship(
  db: Db,
  authorUserId: string,
  referralId: string,
): Promise<{ relationship: AuthorRelationship; subjectUserId: string | null; referralStatus: string | null }> {
  const [referral] = await db
    .select({ postedByUserId: homeCaseReferrals.postedByUserId, status: homeCaseReferrals.status })
    .from(homeCaseReferrals)
    .where(and(eq(homeCaseReferrals.id, referralId), isNull(homeCaseReferrals.deletedAt)));
  if (!referral) return { relationship: "none", subjectUserId: null, referralStatus: null };

  if (referral.postedByUserId === authorUserId) {
    const [accepted] = await db
      .select({ therapistUserId: referralInterest.therapistUserId })
      .from(referralInterest)
      .where(and(eq(referralInterest.referralId, referralId), eq(referralInterest.status, "accepted")));
    return { relationship: "poster", subjectUserId: accepted?.therapistUserId ?? null, referralStatus: referral.status };
  }

  const [myInterest] = await db
    .select({ status: referralInterest.status })
    .from(referralInterest)
    .where(and(eq(referralInterest.referralId, referralId), eq(referralInterest.therapistUserId, authorUserId)));
  if (myInterest?.status === "accepted") {
    return { relationship: "accepter", subjectUserId: referral.postedByUserId, referralStatus: referral.status };
  }

  return { relationship: "none", subjectUserId: null, referralStatus: referral.status };
}

export async function writePeerNoteTx(
  db: Db,
  authorUserId: string,
  referralId: string,
  body: string,
): Promise<{ id: string }> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("A peer note can't be empty");
  if (trimmed.length > MAX_BODY_LENGTH) {
    throw new Error(`A peer note must be ${MAX_BODY_LENGTH} characters or fewer`);
  }

  const authzUser = await loadAuthzUser(db, authorUserId);
  const { relationship, subjectUserId, referralStatus } = await resolveRelationship(db, authorUserId, referralId);

  const [existing] = await db
    .select({ id: peerNotes.id })
    .from(peerNotes)
    .where(and(eq(peerNotes.authorUserId, authorUserId), eq(peerNotes.referralId, referralId)));

  const decision = can(authzUser, {
    type: "write_peer_note",
    authorRelationship: relationship,
    referralStatus: referralStatus ?? "",
    alreadyWritten: Boolean(existing),
  });
  if (!decision.allowed) throw new Error(decision.reason);
  if (!subjectUserId) throw new Error("Could not determine who this note is about");

  const [row] = await db
    .insert(peerNotes)
    .values({ subjectUserId, authorUserId, referralId, body: trimmed })
    .returning({ id: peerNotes.id });
  return row;
}

export async function editPeerNoteTx(db: Db, authorUserId: string, noteId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("A peer note can't be empty");
  if (trimmed.length > MAX_BODY_LENGTH) {
    throw new Error(`A peer note must be ${MAX_BODY_LENGTH} characters or fewer`);
  }

  const authzUser = await loadAuthzUser(db, authorUserId);

  const [note] = await db
    .select({ authorUserId: peerNotes.authorUserId, status: peerNotes.status, createdAt: peerNotes.createdAt })
    .from(peerNotes)
    .where(eq(peerNotes.id, noteId));
  if (!note) throw new Error("Note not found");

  const withinEditWindow = Date.now() - note.createdAt.getTime() < EDIT_WINDOW_MS;
  const decision = can(authzUser, {
    type: "edit_peer_note",
    isAuthor: note.authorUserId === authorUserId,
    withinEditWindow,
    status: note.status,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  await db.update(peerNotes).set({ body: trimmed }).where(eq(peerNotes.id, noteId));
}

/** Silent, one-tap, subject-only — never an edit, never notifies the
 * author (§8E-style "silent by design," same discipline as circles.ts). */
export async function hidePeerNoteTx(db: Db, subjectUserId: string, noteId: string): Promise<void> {
  const authzUser = await loadAuthzUser(db, subjectUserId);

  const [note] = await db.select({ subjectUserId: peerNotes.subjectUserId }).from(peerNotes).where(eq(peerNotes.id, noteId));
  if (!note) throw new Error("Note not found");

  const decision = can(authzUser, { type: "hide_peer_note", isSubject: note.subjectUserId === subjectUserId });
  if (!decision.allowed) throw new Error(decision.reason);

  await db.update(peerNotes).set({ status: "hidden_by_subject" }).where(eq(peerNotes.id, noteId));
}

export async function removePeerNoteAsAdminTx(db: Db, adminActorUserId: string, noteId: string): Promise<void> {
  const authzUser = await loadAuthzUser(db, adminActorUserId);
  const decision = can(authzUser, { type: "remove_peer_note_as_admin" });
  if (!decision.allowed) throw new Error(decision.reason);

  await db.update(peerNotes).set({ status: "removed_by_admin" }).where(eq(peerNotes.id, noteId));
}

export interface DisplayPeerNote {
  id: string;
  body: string;
  createdAt: Date;
  authorUserId: string;
  authorDisplayName: string | null;
  authorVerificationStage: "unverified" | "qualification_confirmed" | "credentials_verified";
}

/** The only read path a profile page should use — caps at
 * MAX_NOTES_SHOWN_PER_PROFILE by recency so "never a count, never all of
 * them" is enforced here rather than left to every caller to remember.
 * Whether the viewer may hide a note is a page-level fact (are they
 * looking at their own profile?), not a per-note one — the caller
 * already knows that without needing it echoed back per row. */
export async function listPeerNotesForProfile(db: Db, subjectUserId: string): Promise<DisplayPeerNote[]> {
  return db
    .select({
      id: peerNotes.id,
      body: peerNotes.body,
      createdAt: peerNotes.createdAt,
      authorUserId: peerNotes.authorUserId,
      authorDisplayName: users.displayName,
      authorVerificationStage: users.verificationStage,
    })
    .from(peerNotes)
    .innerJoin(users, eq(users.id, peerNotes.authorUserId))
    .where(and(eq(peerNotes.subjectUserId, subjectUserId), eq(peerNotes.status, "visible")))
    .orderBy(desc(peerNotes.createdAt))
    .limit(MAX_NOTES_SHOWN_PER_PROFILE);
}

export interface MyPeerNote {
  id: string;
  body: string;
  createdAt: Date;
  status: "visible" | "hidden_by_subject" | "removed_by_admin";
}

/** For the referral detail page's write-prompt: has this viewer already
 * written a note for this specific referral (regardless of status — a
 * hidden-by-subject note still counts as "already written," write-once
 * per referral per author isn't undone by the subject hiding it). */
export async function getMyPeerNoteForReferral(
  db: Db,
  authorUserId: string,
  referralId: string,
): Promise<MyPeerNote | null> {
  const [row] = await db
    .select({ id: peerNotes.id, body: peerNotes.body, createdAt: peerNotes.createdAt, status: peerNotes.status })
    .from(peerNotes)
    .where(and(eq(peerNotes.authorUserId, authorUserId), eq(peerNotes.referralId, referralId)));
  return row ?? null;
}
