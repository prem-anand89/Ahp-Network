// §8H — the table-by-table retention/anonymisation matrix's automatic,
// time-based purges. NOT the "on erasure request" half of that matrix —
// those rules only fire when a specific user asks for deletion, handled
// separately by an admin-triggered flow (see the data-export/deletion-
// request work). These run unconditionally, on a schedule, regardless of
// whether anyone has asked ("time-based purges run regardless of deletion
// requests" — §8H).
//
// audit_logs is the one row this file cannot touch directly: ahp_app has
// UPDATE/DELETE revoked on it (CLAUDE.md's append-only non-negotiable), so
// its purge goes through the narrowly-scoped purge_old_audit_logs() SQL
// function (drizzle/0022) instead of a DELETE statement here.

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  credentials,
  feedback,
  homeCaseReferrals,
  notificationOutbox,
  practiceClaims,
  profileContactReveals,
  pushSubscriptions,
  referralStatusUpdates,
} from "@/db/schema";
import type { getDb } from "@/db/db";
import { CREDENTIALS_BUCKET, deleteR2Object, type R2Env } from "./r2";

type Db = Awaited<ReturnType<typeof getDb>>;

const DAY_MS = 24 * 60 * 60 * 1000;

function monthsAgo(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

export interface RetentionRunResult {
  credentialsDocumentsPurged: number;
  referralContactFieldsPurged: number;
  referralOutcomeNotesPurged: number;
  pushSubscriptionsPurged: number;
  practiceClaimsDocumentsPurged: number;
  contactRevealsPurged: number;
  feedbackMessagesPurged: number;
  notificationPayloadsPurged: number;
  auditLogsPurged: number;
}

/** §8H: "documents: 12 months post-verification." Deletes the R2 object
 * and nulls the OCR/registration-number columns it fed — status and
 * verified_at (the actual verification record) stay, per the matrix. */
async function purgeExpiredCredentialDocuments(db: Db, env: R2Env): Promise<number> {
  const cutoff = monthsAgo(12);
  const rows = await db
    .select({ id: credentials.id, documentUrl: credentials.documentUrl })
    .from(credentials)
    .where(
      and(
        eq(credentials.status, "approved"),
        lt(credentials.verifiedAt, cutoff),
        sql`${credentials.documentUrl} IS NOT NULL`,
      ),
    );

  for (const row of rows) {
    if (row.documentUrl) await deleteR2Object(env, CREDENTIALS_BUCKET, row.documentUrl);
  }
  if (rows.length === 0) return 0;

  await db
    .update(credentials)
    .set({ documentUrl: null, registrationNumber: null, ocrExtractedJson: null })
    .where(
      inArray(
        credentials.id,
        rows.map((r) => r.id),
      ),
    );

  return rows.length;
}

/** §8H: "contact fields: purge 90 days after completed/expired." Keyed on
 * referral age, not status — `completed`/`expired` are declared in the
 * status CHECK but nothing in the codebase ever writes them (only
 * `open`/`shortlisted`/`accepted` are reachable today), so a status-gated
 * filter matched zero rows in production regardless of age. Uses
 * `accepted_at` as the state-change timestamp where it exists (the moment
 * the patient's contact details actually reached someone), falling back to
 * `created_at` for a referral that never got accepted — both are real
 * timestamps already on the row, unlike `completed_at`/`expired_at`, which
 * don't exist as columns. */
async function purgeExpiredReferralContactFields(db: Db): Promise<number> {
  const cutoff = daysAgo(90);
  const result = await db
    .update(homeCaseReferrals)
    .set({ patientSummary: null, locationAddress: null })
    .where(
      and(
        sql`coalesce(${homeCaseReferrals.acceptedAt}, ${homeCaseReferrals.createdAt}) < ${cutoff.toISOString()}`,
        sql`(${homeCaseReferrals.patientSummary} IS NOT NULL OR ${homeCaseReferrals.locationAddress} IS NOT NULL)`,
      ),
    )
    .returning({ id: homeCaseReferrals.id });

  return result.length;
}

/** REFERRAL_LOOP_SPEC_ADDENDUM.md §8: "note purges on the same 90-day
 * clock as the referral's contact fields." outcome/discontinued_reason and
 * timestamps persist — they aren't patient-identifying and they carry
 * §11's metrics; only the free-text note is nulled. */
async function purgeExpiredReferralOutcomeNotes(db: Db): Promise<number> {
  const cutoff = daysAgo(90);
  const result = await db
    .update(referralStatusUpdates)
    .set({ note: null })
    .where(and(lt(referralStatusUpdates.createdAt, cutoff), sql`${referralStatusUpdates.note} IS NOT NULL`))
    .returning({ id: referralStatusUpdates.id });
  return result.length;
}

/** §8H: "purge with no successful delivery in 90 days." last_seen_at is
 * updated on every successful push (see the push-subscriptions comment in
 * schema.ts) — a stale one means the subscription is dead. */
async function purgeStalePushSubscriptions(db: Db): Promise<number> {
  const cutoff = daysAgo(90);
  const result = await db.delete(pushSubscriptions).where(lt(pushSubscriptions.lastSeenAt, cutoff)).returning({ id: pushSubscriptions.id });
  return result.length;
}

/** §8H: "documents: purge 12 months post-decision." document_url is
 * NOT NULL on this table (unlike credentials.document_url), so a purged
 * row is marked with '' rather than NULL below — the select filter must
 * exclude '' too, or an already-purged row matches `IS NOT NULL` forever
 * and gets re-selected (and re-counted) on every subsequent run. */
async function purgeExpiredPracticeClaimDocuments(db: Db, env: R2Env): Promise<number> {
  const cutoff = monthsAgo(12);
  const rows = await db
    .select({ id: practiceClaims.id, documentUrl: practiceClaims.documentUrl })
    .from(practiceClaims)
    .where(
      and(
        sql`${practiceClaims.status} IN ('approved','rejected')`,
        lt(practiceClaims.reviewedAt, cutoff),
        sql`${practiceClaims.documentUrl} != ''`,
      ),
    );

  for (const row of rows) {
    if (row.documentUrl) await deleteR2Object(env, CREDENTIALS_BUCKET, row.documentUrl);
  }
  if (rows.length === 0) return 0;

  await db
    .update(practiceClaims)
    .set({ documentUrl: "", registrationNumber: null, queryMessage: null })
    .where(
      inArray(
        practiceClaims.id,
        rows.map((r) => r.id),
      ),
    );

  return rows.length;
}

/** §8H: "purge revealed_data at 90 days" — profile_contact_reveals'
 * ip_hash/user_agent, consistent with §9B8's treatment of the same field
 * shape. profile_id/timestamps stay for the rate-limit history. */
async function purgeStaleContactReveals(db: Db): Promise<number> {
  const cutoff = daysAgo(90);
  const result = await db
    .update(profileContactReveals)
    .set({ userAgent: null })
    .where(and(lt(profileContactReveals.revealedAt, cutoff), sql`${profileContactReveals.userAgent} IS NOT NULL`))
    .returning({ id: profileContactReveals.id });
  return result.length;
}

/** §8H: "purge messages at 24 months." Category/status stay for the
 * aggregate backlog view. */
async function purgeOldFeedbackMessages(db: Db): Promise<number> {
  const cutoff = monthsAgo(24);
  const result = await db
    .update(feedback)
    .set({ message: "[purged]" })
    .where(and(lt(feedback.createdAt, cutoff), sql`${feedback.message} != '[purged]'`))
    .returning({ id: feedback.id });
  return result.length;
}

/** §8H's "notifications" row → notification_outbox, the v19 successor
 * table (Phase 6/7). "Purge payloads at 90 days." */
async function purgeOldNotificationPayloads(db: Db): Promise<number> {
  const cutoff = daysAgo(90);
  const result = await db
    .update(notificationOutbox)
    .set({ payload: {} })
    .where(and(lt(notificationOutbox.createdAt, cutoff), sql`${notificationOutbox.payload} != '{}'::jsonb`))
    .returning({ id: notificationOutbox.id });
  return result.length;
}

/** §8H: "24 months." Routed through purge_old_audit_logs() (drizzle/0022)
 * since ahp_app cannot DELETE this table directly. Uses the raw postgres.js
 * client (db.$client), same pattern as the referral-transition functions
 * in referral-actions.ts, since this is a single `SELECT fn(...)` call. */
async function purgeOldAuditLogs(db: Db): Promise<number> {
  const [row] = await db.$client<{ purge_old_audit_logs: number }[]>`SELECT purge_old_audit_logs(24)`;
  return row?.purge_old_audit_logs ?? 0;
}

/**
 * Runs every automatic, time-based §8H purge once. Idempotent — running
 * it twice in a row purges nothing the second time, since each rule only
 * matches rows that still have the data to remove. Intended to run daily
 * (see /api/cron/retention), a coarse-enough cadence for month/day-scale
 * windows, unlike the referral deadline scheduler's sub-hourly one.
 */
export async function runRetentionPurge(db: Db, env: R2Env): Promise<RetentionRunResult> {
  return {
    credentialsDocumentsPurged: await purgeExpiredCredentialDocuments(db, env),
    referralContactFieldsPurged: await purgeExpiredReferralContactFields(db),
    referralOutcomeNotesPurged: await purgeExpiredReferralOutcomeNotes(db),
    pushSubscriptionsPurged: await purgeStalePushSubscriptions(db),
    practiceClaimsDocumentsPurged: await purgeExpiredPracticeClaimDocuments(db, env),
    contactRevealsPurged: await purgeStaleContactReveals(db),
    feedbackMessagesPurged: await purgeOldFeedbackMessages(db),
    notificationPayloadsPurged: await purgeOldNotificationPayloads(db),
    auditLogsPurged: await purgeOldAuditLogs(db),
  };
}
