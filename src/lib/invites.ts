// §8A4 (Phase 8) — invitations. WhatsApp deep link primary, no address-book
// access, no invitee contact details stored, no reward layer (considered
// and rejected outright — CLAUDE.md). One row per send/share action; the
// 20/week rate limit is a count of this inviter's own rows in the last 7
// days.

import { and, count, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { invites, users } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

const WEEKLY_RATE_LIMIT = 20;

/** Shared between proxy.ts (sets it on a `?ref=` visit) and the two
 * signup call sites (read it once, at first insert only). */
export const INVITE_REF_COOKIE_NAME = "ahp_ref";

export class InviteRateLimitError extends Error {
  constructor() {
    super(`No more than ${WEEKLY_RATE_LIMIT} invites per person per week`);
    this.name = "InviteRateLimitError";
  }
}

function generateInviteCode(): string {
  // Short, URL-safe, not guessable enough to matter for something this
  // low-stakes (it unlocks nothing but an attribution line) — 8 chars of
  // base36 from crypto.randomUUID() is plenty.
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export interface CreateInviteInput {
  inviterUserId: string;
  channel: "whatsapp" | "copy_link" | "sms";
}

export interface CreateInviteResult {
  code: string;
}

/**
 * Rejects past the 20/week rate limit (§8A4) with a typed error rather
 * than a generic throw, so the caller can show a specific message instead
 * of "something went wrong."
 */
export async function createInviteTx(db: Db, input: CreateInviteInput): Promise<CreateInviteResult> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [{ recent }] = await db
    .select({ recent: count() })
    .from(invites)
    .where(and(eq(invites.inviterUserId, input.inviterUserId), gte(invites.createdAt, since)));

  if (recent >= WEEKLY_RATE_LIMIT) {
    throw new InviteRateLimitError();
  }

  const code = generateInviteCode();
  await db.insert(invites).values({
    inviterUserId: input.inviterUserId,
    code,
    channel: input.channel,
  });

  return { code };
}

/**
 * Called at signup when a `?ref=<code>` was captured (see the login/OAuth
 * callback wiring). Marks the FIRST matching un-accepted invite row as
 * accepted — idempotent in effect, since ensureUserAndIdentities only ever
 * calls this once per new user (onConflictDoNothing gates the users insert
 * itself). Silently no-ops on an unknown/already-accepted code: a stale or
 * mistyped ref link should never block signup.
 */
export async function acceptInviteTx(db: Db, code: string, newUserId: string): Promise<void> {
  const [invite] = await db
    .select({ id: invites.id, inviterUserId: invites.inviterUserId })
    .from(invites)
    .where(and(eq(invites.code, code), isNull(invites.acceptedByUserId)))
    .limit(1);

  if (!invite) return;

  await db
    .update(invites)
    .set({ acceptedByUserId: newUserId, acceptedAt: new Date() })
    .where(eq(invites.id, invite.id));

  await db.update(users).set({ invitedByUserId: invite.inviterUserId }).where(eq(users.id, newUserId));
}

/** §10H reciprocity stat — "N people joined AHP Network through your invite." */
export async function countAcceptedInvites(db: Db, inviterUserId: string): Promise<number> {
  const [{ accepted }] = await db
    .select({ accepted: count() })
    .from(invites)
    .where(and(eq(invites.inviterUserId, inviterUserId), isNotNull(invites.acceptedByUserId)));
  return accepted;
}
