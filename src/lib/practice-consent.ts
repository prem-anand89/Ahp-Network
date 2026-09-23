// Round 2 step 3 (plan decision 9) — practice 2-way consent. Either side
// of an affiliation can initiate: a practice invites a specific
// therapist (assertedBy: 'practice'), or a therapist requests to join a
// practice they're not affiliated with yet (assertedBy: 'self'). The
// other side accepts or declines. Plain application-level writes, not a
// PL/pgSQL function — CLAUDE.md's single-statement-function requirement
// is specific to the three referral state transitions and their
// concurrency race (§8D); this is a low-concurrency, one-row-at-a-time
// membership flow with no comparable race to guard.
//
// Every function here is the one place practice_users.status ever
// changes for the invite/request/respond/remove surface — see
// src/db/schema.ts's header comment on that column for why every OTHER
// read of this table must filter status = 'active'.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { notificationOutbox, practiceUsers, users } from "@/db/schema";
import type { getDb } from "@/db/db";
import { requirePracticeEditor } from "@/lib/practice-edit";
import { PRACTICE_CONSENT_COPY } from "@/lib/copy";

type Db = Awaited<ReturnType<typeof getDb>>;

/** The caller's own current (non-ended, non-deleted) affiliation row, if
 * any — regardless of status, so invite/request can tell "already a
 * member," "already pending," and "free to invite/request" apart. */
async function findExistingAffiliation(db: Db, practiceId: string, userId: string) {
  const [row] = await db
    .select({ id: practiceUsers.id, status: practiceUsers.status })
    .from(practiceUsers)
    .where(
      and(
        eq(practiceUsers.practiceId, practiceId),
        eq(practiceUsers.userId, userId),
        isNull(practiceUsers.deletedAt),
        isNull(practiceUsers.endedAt),
      ),
    );
  return row;
}

function assertNotAlreadyAffiliated(existing: { status: string } | undefined): void {
  if (!existing) return;
  if (existing.status === "active") throw new Error(PRACTICE_CONSENT_COPY.alreadyMemberError);
  if (existing.status === "invited" || existing.status === "requested") {
    throw new Error(PRACTICE_CONSENT_COPY.alreadyPendingError);
  }
  // 'declined' or 'removed' — a closed chapter, not a block on trying again.
}

async function notifyActiveOwnersAndManagers(
  db: Db,
  practiceId: string,
  template: string,
  excludeUserId?: string,
): Promise<void> {
  const recipients = await db
    .select({ userId: practiceUsers.userId })
    .from(practiceUsers)
    .where(
      and(
        eq(practiceUsers.practiceId, practiceId),
        inArray(practiceUsers.accessRole, ["owner", "manager"]),
        eq(practiceUsers.status, "active"),
        isNull(practiceUsers.endedAt),
        isNull(practiceUsers.deletedAt),
      ),
    );
  for (const recipient of recipients) {
    if (recipient.userId === excludeUserId) continue;
    await db.insert(notificationOutbox).values({
      userId: recipient.userId,
      channel: "push",
      template,
      payload: { practiceId },
    });
  }
}

export interface InvitePracticeMemberInput {
  practiceId: string;
  inviterUserId: string;
  inviteeEmail: string;
  accessRole: "manager" | "staff";
}

/** Only an active owner/manager can invite (requirePracticeEditor). The
 * invitee must be an existing therapist account — this isn't a signup
 * flow, it's an affiliation offer to someone already on the platform. */
export async function invitePracticeMemberByEmail(db: Db, input: InvitePracticeMemberInput): Promise<void> {
  await requirePracticeEditor(db, input.practiceId, input.inviterUserId);

  const [invitee] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.email, input.inviteeEmail), eq(users.accountType, "therapist"), isNull(users.deletedAt)),
    );
  if (!invitee) throw new Error(PRACTICE_CONSENT_COPY.inviteNotFoundError);

  assertNotAlreadyAffiliated(await findExistingAffiliation(db, input.practiceId, invitee.id));

  await db.insert(practiceUsers).values({
    practiceId: input.practiceId,
    userId: invitee.id,
    accessRole: input.accessRole,
    relationshipType: "works_at",
    status: "invited",
    assertedBy: "practice",
    isPublic: true,
  });

  await db.insert(notificationOutbox).values({
    userId: invitee.id,
    channel: "push",
    template: "practice_invite_received",
    payload: { practiceId: input.practiceId },
  });
}

/** A therapist requesting to join an existing practice — always as
 * 'staff'. Requesting owner/manager access isn't this mechanism; that's
 * the admin-reviewed ownership claim (practice-claims.ts), on purpose. */
export async function requestPracticeMembership(
  db: Db,
  { practiceId, requesterUserId }: { practiceId: string; requesterUserId: string },
): Promise<void> {
  assertNotAlreadyAffiliated(await findExistingAffiliation(db, practiceId, requesterUserId));

  await db.insert(practiceUsers).values({
    practiceId,
    userId: requesterUserId,
    accessRole: "staff",
    relationshipType: "works_at",
    status: "requested",
    assertedBy: "self",
    isPublic: true,
  });

  await notifyActiveOwnersAndManagers(db, practiceId, "practice_request_received");
}

export async function respondToPracticeInvite(
  db: Db,
  { practiceId, therapistUserId, accept }: { practiceId: string; therapistUserId: string; accept: boolean },
): Promise<void> {
  const [row] = await db
    .select({ id: practiceUsers.id })
    .from(practiceUsers)
    .where(
      and(
        eq(practiceUsers.practiceId, practiceId),
        eq(practiceUsers.userId, therapistUserId),
        eq(practiceUsers.status, "invited"),
        isNull(practiceUsers.deletedAt),
      ),
    );
  if (!row) throw new Error(PRACTICE_CONSENT_COPY.respondNotFoundError);

  await db
    .update(practiceUsers)
    .set(
      accept
        ? { status: "active", startedAt: new Date(), updatedAt: new Date() }
        : { status: "declined", updatedAt: new Date() },
    )
    .where(eq(practiceUsers.id, row.id));

  if (accept) {
    await notifyActiveOwnersAndManagers(db, practiceId, "practice_member_joined", therapistUserId);
  }
}

export async function respondToPracticeRequest(
  db: Db,
  {
    practiceId,
    requesterUserId,
    responderUserId,
    accept,
  }: { practiceId: string; requesterUserId: string; responderUserId: string; accept: boolean },
): Promise<void> {
  await requirePracticeEditor(db, practiceId, responderUserId);

  const [row] = await db
    .select({ id: practiceUsers.id })
    .from(practiceUsers)
    .where(
      and(
        eq(practiceUsers.practiceId, practiceId),
        eq(practiceUsers.userId, requesterUserId),
        eq(practiceUsers.status, "requested"),
        isNull(practiceUsers.deletedAt),
      ),
    );
  if (!row) throw new Error(PRACTICE_CONSENT_COPY.respondNotFoundError);

  await db
    .update(practiceUsers)
    .set(
      accept
        ? { status: "active", startedAt: new Date(), updatedAt: new Date() }
        : { status: "declined", updatedAt: new Date() },
    )
    .where(eq(practiceUsers.id, row.id));

  await db.insert(notificationOutbox).values({
    userId: requesterUserId,
    channel: "push",
    template: accept ? "practice_request_accepted" : "practice_request_declined",
    payload: { practiceId },
  });
}

/** Self-leave is always allowed. An owner/manager removing someone else
 * is allowed only for a practice-initiated ('practice') affiliation —
 * schema.ts's own header comment: a therapist-asserted ('self')
 * affiliation can only be disputed, never unilaterally removed by the
 * practice, and an owner row can never be removed by a teammate. */
export async function removePracticeMember(
  db: Db,
  { practiceId, actingUserId, targetUserId }: { practiceId: string; actingUserId: string; targetUserId: string },
): Promise<void> {
  const [row] = await db
    .select({ id: practiceUsers.id, accessRole: practiceUsers.accessRole, assertedBy: practiceUsers.assertedBy })
    .from(practiceUsers)
    .where(
      and(
        eq(practiceUsers.practiceId, practiceId),
        eq(practiceUsers.userId, targetUserId),
        eq(practiceUsers.status, "active"),
        isNull(practiceUsers.deletedAt),
      ),
    );
  if (!row) throw new Error(PRACTICE_CONSENT_COPY.respondNotFoundError);

  if (actingUserId !== targetUserId) {
    await requirePracticeEditor(db, practiceId, actingUserId);
    if (row.accessRole === "owner") throw new Error(PRACTICE_CONSENT_COPY.ownerRemovalError);
    if (row.assertedBy === "self") throw new Error(PRACTICE_CONSENT_COPY.selfAssertedRemovalError);
  }

  await db
    .update(practiceUsers)
    .set({ status: "removed", endedAt: new Date(), endedByUserId: actingUserId, updatedAt: new Date() })
    .where(eq(practiceUsers.id, row.id));
}
