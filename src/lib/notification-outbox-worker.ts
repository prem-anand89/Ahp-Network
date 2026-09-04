// §8D — the separate worker that actually sends what the three referral
// transactions write to notification_outbox. [v19]: claims with
// SELECT ... FOR UPDATE SKIP LOCKED so overlapping runs never grab the
// same row, marks sent/failed with exponential backoff, and never sends a
// notification inline inside a referral transaction (CLAUDE.md
// non-negotiable) — that discipline lives entirely upstream, in
// referral-actions.ts and the three PL/pgSQL functions; this file only
// ever reads rows already written there.
//
// The actual channel implementations (push via VAPID, email) are Phase
// 7's job per BUILD_SEQUENCE.md — this file takes a `send` function as a
// parameter so the claim/backoff/dedupe mechanics this phase owns are
// fully testable now, independent of which channel eventually sends.

import { and, eq, lte, sql } from "drizzle-orm";
import { notificationOutbox } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export type NotificationSendResult = { ok: true } | { ok: false; error: string };

export type NotificationSender = (row: {
  id: string;
  userId: string;
  channel: string;
  template: string;
  payload: unknown;
}) => Promise<NotificationSendResult>;

const MAX_ATTEMPTS = 5;
// Exponential backoff in minutes: 1, 2, 4, 8, 16.
const BACKOFF_MINUTES = [1, 2, 4, 8, 16];

function backoffDelayMs(attemptCount: number): number {
  const minutes = BACKOFF_MINUTES[Math.min(attemptCount, BACKOFF_MINUTES.length - 1)];
  return minutes * 60 * 1000;
}

async function claimBatch(db: Db, limit: number) {
  // FOR UPDATE SKIP LOCKED — a concurrent run (or an overlapping cron
  // firing) skips rows another claimant already has locked, rather than
  // blocking on or double-processing them. Built as a drizzle query-
  // builder UPDATE (with the SKIP LOCKED subquery inlined via `sql`) so
  // `.returning()` maps columns back to camelCase automatically — unlike
  // a fully raw `db.execute(sql...)`, which returns raw snake_case column
  // names and silently produces undefined fields if read as camelCase.
  return db
    .update(notificationOutbox)
    .set({ lockedAt: new Date() })
    .where(sql`${notificationOutbox.id} IN (
      SELECT id FROM notification_outbox
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY next_attempt_at
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )`)
    .returning();
}

/**
 * Claims up to `limit` due rows, sends each via `send`, and marks the
 * outcome. Returns counts for observability — never throws for an
 * individual send failure, since one bad notification must not block the
 * rest of the batch.
 */
export async function processOutboxOnce(
  db: Db,
  send: NotificationSender,
  limit = 50,
): Promise<{ claimed: number; sent: number; failed: number; deadLettered: number }> {
  const claimed = await claimBatch(db, limit);

  let sent = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of claimed) {
    const result = await send({
      id: row.id,
      userId: row.userId,
      channel: row.channel,
      template: row.template,
      payload: row.payload,
    });

    if (result.ok) {
      await db
        .update(notificationOutbox)
        .set({ status: "sent", lastAttemptedAt: new Date(), lockedAt: null })
        .where(eq(notificationOutbox.id, row.id));
      sent += 1;
    } else {
      const attemptCount = row.attemptCount + 1;
      if (attemptCount >= MAX_ATTEMPTS) {
        await db
          .update(notificationOutbox)
          .set({ status: "failed", attemptCount, lastAttemptedAt: new Date(), lockedAt: null })
          .where(eq(notificationOutbox.id, row.id));
        deadLettered += 1;
      } else {
        await db
          .update(notificationOutbox)
          .set({
            attemptCount,
            lastAttemptedAt: new Date(),
            nextAttemptAt: new Date(Date.now() + backoffDelayMs(attemptCount)),
            lockedAt: null,
          })
          .where(eq(notificationOutbox.id, row.id));
      }
      failed += 1;
    }
  }

  return { claimed: claimed.length, sent, failed, deadLettered };
}

/** Diagnostic helper for the ops queue — how far behind the claimable backlog is. */
export async function countClaimableNotifications(db: Db): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationOutbox)
    .where(and(eq(notificationOutbox.status, "pending"), lte(notificationOutbox.nextAttemptAt, new Date())));
  return count;
}
