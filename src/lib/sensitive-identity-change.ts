// §4's sensitive-identity-change protocol — app-level logic sitting above
// whatever issues the session (Supabase Auth). A "sensitive identity
// change" is any of: email change, phone change, linking or unlinking an
// auth identity, or legal_name change. On any of these:
//   1. Require recent re-authentication — a session older than 15 minutes
//      must re-authenticate before the change is accepted.
//   2. Notify BOTH the old and the new verified channel.
//   3. Block referral acceptance and any contact disclosure for 48 hours.
//      The account keeps working for everything else.
//   4. Write audit_logs with action = 'sensitive_identity_change'.
//
// Step 3's referral-claim/contact-disclosure enforcement and step 1's
// re-auth check are the caller's job — this module builds the parts that
// live here: the hold window, the audit write, and (now that Phase 6/7
// built notification_outbox) step 2's alert to the address currently on
// file. What step 2 does NOT yet do: notify the literal OLD address once
// it's no longer the one stored on `users` — that needs a raw-address send
// bypassing the outbox's user_id-based lookup, which has no caller to
// justify it while no profile-edit flow exists yet. Tracked, not faked.

import { eq } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { users, auditLogs, notificationOutbox } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

export const SENSITIVE_FIELDS = [
  "email",
  "phone",
  "legal_name",
  "auth_identity_link",
  "auth_identity_unlink",
] as const;

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

const REAUTH_FRESHNESS_MINUTES = 15;
const CONTACT_DISCLOSURE_HOLD_HOURS = 48;

export function needsReauthentication(lastAuthenticatedAt: Date, now: Date = new Date()): boolean {
  const ageMs = now.getTime() - lastAuthenticatedAt.getTime();
  return ageMs > REAUTH_FRESHNESS_MINUTES * 60 * 1000;
}

export function computeContactDisclosureHoldExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + CONTACT_DISCLOSURE_HOLD_HOURS * 60 * 60 * 1000);
}

export function isWithinContactDisclosureHold(
  holdUntil: Date | null,
  now: Date = new Date(),
): boolean {
  return holdUntil !== null && holdUntil.getTime() > now.getTime();
}

export interface RecordSensitiveIdentityChangeParams {
  userId: string;
  field: SensitiveField;
  oldValue: string | null;
  newValue: string | null;
  ipAddress?: string;
}

/**
 * Steps 2 (partial — see module note), 3 and 4 of the protocol: enqueues
 * the on-file-address alert, sets the 48-hour hold, and writes the audit
 * log entry. Step 1 (re-auth freshness) is checked by the caller BEFORE
 * this runs, using needsReauthentication() — this function assumes that
 * gate has already passed.
 */
export async function recordSensitiveIdentityChange(
  db: Db,
  params: RecordSensitiveIdentityChangeParams,
): Promise<void> {
  const holdUntil = computeContactDisclosureHoldExpiry();

  await db
    .update(users)
    .set({ contactDisclosureHoldUntil: holdUntil })
    .where(eq(users.id, params.userId));

  await db.insert(auditLogs).values({
    actorUserId: params.userId,
    actorType: "user",
    actingContext: "therapist",
    action: "sensitive_identity_change",
    targetTable: "users",
    targetId: params.userId,
    outcome: "success",
    // §5 — redact PII before storage. oldValue/newValue for email/phone/
    // legal_name ARE the PII this rule exists to protect, so only the
    // field name and a change-happened marker are recorded, never the
    // actual values.
    beforeState: { field: params.field, changed: params.oldValue !== null },
    afterState: { field: params.field, changed: params.newValue !== null },
    ipAddress: params.ipAddress,
  });

  // Step 2, partial: alert whatever address/device is currently on file —
  // never sent inline (CLAUDE.md), always through the outbox. Payload
  // carries only the field name, same redaction discipline as the audit
  // row above; the actual old/new values never leave the caller.
  await db.insert(notificationOutbox).values({
    userId: params.userId,
    channel: "email",
    template: "identity_change_alert",
    payload: { field: params.field },
  });
}
