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
// Steps 2 and 3's actual referral-claim/contact-disclosure enforcement
// depend on infrastructure that doesn't exist until later phases
// (notification_outbox — Phase 6/7; the referral board itself — Phase 6).
// This module builds the parts that CAN exist now — the re-auth freshness
// check, the hold window, and the audit write — so the check has a home
// from day one rather than being invented ad hoc when those phases land.
// Step 2's actual send is a documented TODO, not silently skipped.

import { eq } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { users, auditLogs } from "@/db/schema";

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
 * Steps 3 and 4 of the protocol — sets the 48-hour hold and writes the
 * audit log entry. Step 1 (re-auth freshness) is checked by the caller
 * BEFORE this runs, using needsReauthentication() — this function assumes
 * that gate has already passed. Step 2 (dual-channel notify) is a TODO:
 * notification_outbox doesn't exist until a later phase.
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

  // TODO(Phase 6/7 — notification_outbox): notify both the old and new
  // verified channel per step 2. Not implemented here because the outbox
  // pattern this must use (CLAUDE.md: "notifications are never sent inline
  // inside a database transaction") doesn't exist until that phase.
}
