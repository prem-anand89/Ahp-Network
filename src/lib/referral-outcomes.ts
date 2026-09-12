// REFERRAL_LOOP_SPEC_ADDENDUM.md — the loop *after* accept. Same DI
// pattern as referral-actions.ts (db + userId as explicit parameters, so
// this is testable against a real local Postgres without a Supabase
// session). Adds no new home_case_referrals status transition beyond the
// one this file itself performs, and never touches the three locked
// PL/pgSQL functions (shortlist_referral/accept_referral/lapse_offers).

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { homeCaseReferrals, referralEvents, referralInterest, referralNudges, referralStatusUpdates } from "@/db/schema";
import { can, type AuthzUser } from "@/lib/authz";
import { loadAuthzUser } from "@/lib/require-session";
import { writeAuditLog } from "@/lib/audit";
import type { getDb } from "@/db/db";

export type Db = Awaited<ReturnType<typeof getDb>>;

// Stable DB keys — display labels live in referral-labels.ts
// (REFERRAL_LOOP_SPEC_ADDENDUM.md §3: "stable keys stored, display words
// [alongside the referral board's other field labels], so any label can be
// reworded without a migration"). Kept here, next to the CHECK constraints
// they mirror, as the one place both the schema and the label maps are
// checked against — see referral-labels.test.ts.
export const REFERRAL_OUTCOME_KEYS = [
  "no_patient_contact",
  "contacted_not_started",
  "first_session_done",
  "ongoing",
  "completed_discharged",
  "discontinued",
  "not_suitable_referred_on",
] as const;
export type ReferralOutcome = (typeof REFERRAL_OUTCOME_KEYS)[number];

export const DISCONTINUED_REASON_KEYS = [
  "switched_therapist",
  "not_responding",
  "cost",
  "travel_distance",
  "improved",
  "mismatch",
  "not_comfortable",
  "medical_reason",
  "relocated",
  "other",
] as const;
export type DiscontinuedReason = (typeof DISCONTINUED_REASON_KEYS)[number];

// Outcomes/reasons that earn a free-text note — mirrors the
// referral_status_updates_note_check CHECK constraint exactly. Checked at
// the application layer too so a rejected note fails with the specific
// reason below rather than a bare Postgres constraint-violation message.
const NOTE_ALLOWED_OUTCOMES: ReadonlySet<ReferralOutcome> = new Set([
  "ongoing",
  "completed_discharged",
  "not_suitable_referred_on",
]);
const NOTE_ALLOWED_DISCONTINUED_REASONS: ReadonlySet<DiscontinuedReason> = new Set(["medical_reason", "other"]);

// The outcome timeline is a separate dimension from §8D's state machine
// (explicitly not one of the three locked functions), but three of its
// outcomes genuinely mean the case is done — and REFERRAL_LOOP_SPEC_ADDENDUM.md's
// execution plan corrects the original spec's rejection of this: there is
// exactly one legitimate writer (the therapist holding the sole accepted
// interest row), so there's no race left to arbitrate with a PL/pgSQL
// function. A plain guarded, idempotent UPDATE is enough.
const TERMINAL_OUTCOMES: ReadonlySet<ReferralOutcome> = new Set([
  "completed_discharged",
  "discontinued",
  "not_suitable_referred_on",
]);

const MAX_NOTE_LENGTH = 500;

export interface ReportReferralOutcomeInput {
  outcome: ReferralOutcome;
  note?: string | null;
  discontinuedReason?: DiscontinuedReason | null;
}

/**
 * §7 — eligibility is the reporter's own referral_interest row being
 * 'accepted', with the referral itself at 'accepted' or later (i.e. the
 * handover already happened). The spec's original gate on
 * 'contact_acknowledged'/'completed' was inert as written —
 * contact_acknowledged is direct-mode-only and dormant all pilot, and
 * completed was never written by anything before this function existed.
 */
export async function reportOutcomeTx(db: Db, userId: string, referralId: string, input: ReportReferralOutcomeInput) {
  const note = input.note?.trim() || null;
  if (note && note.length > MAX_NOTE_LENGTH) {
    throw new Error(`Handover note must be ${MAX_NOTE_LENGTH} characters or fewer`);
  }
  if (input.outcome === "discontinued" && !input.discontinuedReason) {
    throw new Error("A reason is required when reporting a discontinued referral");
  }
  if (input.outcome !== "discontinued" && input.discontinuedReason) {
    throw new Error("A discontinued reason only applies to the discontinued outcome");
  }
  if (
    note &&
    !NOTE_ALLOWED_OUTCOMES.has(input.outcome) &&
    !(input.outcome === "discontinued" && NOTE_ALLOWED_DISCONTINUED_REASONS.has(input.discontinuedReason as DiscontinuedReason))
  ) {
    throw new Error("A note isn't available on this outcome");
  }

  const authzUser = await loadAuthzUser(db, userId);

  const [referral] = await db
    .select({ status: homeCaseReferrals.status, consentTextVersion: homeCaseReferrals.consentTextVersion })
    .from(homeCaseReferrals)
    .where(and(eq(homeCaseReferrals.id, referralId), isNull(homeCaseReferrals.deletedAt)));
  if (!referral) throw new Error("Referral not found");

  const [interest] = await db
    .select({ status: referralInterest.status })
    .from(referralInterest)
    .where(and(eq(referralInterest.referralId, referralId), eq(referralInterest.therapistUserId, userId)));

  const decision = can(authzUser, {
    type: "report_referral_outcome",
    interestStatus: interest?.status ?? null,
    referralStatus: referral.status,
    consentTextVersion: referral.consentTextVersion,
    hasNote: Boolean(note),
  });
  if (!decision.allowed) throw new Error(decision.reason);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(referralStatusUpdates)
      .values({
        referralId,
        reportedByUserId: userId,
        outcome: input.outcome,
        note,
        discontinuedReason: input.outcome === "discontinued" ? input.discontinuedReason : null,
      })
      .returning();

    await tx.insert(referralEvents).values({
      referralId,
      eventType: "status_update_reported",
      actorUserId: userId,
      payload: { outcome: input.outcome, has_note: Boolean(note) },
    });

    // Terminal outcome closes the referral — plain, guarded, idempotent
    // update, not one of the three locked functions. Never touches
    // referral_interest, so the 2-slot race and accept transaction are
    // untouched. No-ops (rowCount 0) once the referral is already
    // 'completed' or 'auto_closed' — a second terminal report is not an
    // error, just a no-op on this half of the write.
    if (TERMINAL_OUTCOMES.has(input.outcome)) {
      await tx
        .update(homeCaseReferrals)
        .set({ status: "completed", updatedAt: new Date() })
        .where(and(eq(homeCaseReferrals.id, referralId), eq(homeCaseReferrals.status, "accepted")));
    }

    return { statusUpdateId: row.id };
  });
}

/**
 * §5 — the referring therapist's one canned nudge. No free text, no
 * reply. Rate limit is a DB fact, not in-memory: the conditional insert
 * below returns zero rows when a nudge already exists inside the last 14
 * days, which the caller surfaces as "you've already nudged recently"
 * rather than a hard error — there is nothing wrong with the request.
 */
export async function sendNudgeTx(db: Db, userId: string, referralId: string): Promise<{ sent: boolean }> {
  const authzUser = await loadAuthzUser(db, userId);

  const [referral] = await db
    .select({ status: homeCaseReferrals.status, postedByUserId: homeCaseReferrals.postedByUserId })
    .from(homeCaseReferrals)
    .where(and(eq(homeCaseReferrals.id, referralId), isNull(homeCaseReferrals.deletedAt)));
  if (!referral) throw new Error("Referral not found");

  const decision = can(authzUser, {
    type: "nudge_referral_outcome",
    isPoster: referral.postedByUserId === userId,
    referralStatus: referral.status,
  });
  if (!decision.allowed) throw new Error(decision.reason);

  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO ${referralNudges} (referral_id, sent_by_user_id)
    SELECT ${referralId}::uuid, ${userId}::uuid
    WHERE NOT EXISTS (
      SELECT 1 FROM ${referralNudges}
      WHERE ${referralNudges.referralId} = ${referralId}::uuid
        AND ${referralNudges.createdAt} > now() - interval '14 days'
    )
    RETURNING id
  `);

  return { sent: inserted.length > 0 };
}

/** §7 — the poster reads their own referral's timeline; the accepting
 * therapist reads what they themselves reported. No one else, ever. */
export async function canViewReferralOutcomes(
  viewerUserId: string,
  referral: { postedByUserId: string },
  interestStatus: string | null | undefined,
): Promise<boolean> {
  if (referral.postedByUserId === viewerUserId) return true;
  return interestStatus === "accepted";
}

export async function listReferralOutcomeTimeline(db: Db, referralId: string) {
  return db
    .select({
      id: referralStatusUpdates.id,
      outcome: referralStatusUpdates.outcome,
      note: referralStatusUpdates.note,
      discontinuedReason: referralStatusUpdates.discontinuedReason,
      createdAt: referralStatusUpdates.createdAt,
    })
    .from(referralStatusUpdates)
    .where(and(eq(referralStatusUpdates.referralId, referralId), isNull(referralStatusUpdates.deletedAt)))
    .orderBy(referralStatusUpdates.createdAt);
}

/**
 * §7 — "Admins | read — always with an audit_logs entry" (§8G5 already
 * requires this for every admin read of patient data; this table is no
 * exception). Never called from a route handler directly — `can()` gates
 * it here, the same discipline as every other admin read path.
 */
export async function readReferralOutcomesAsAdminTx(db: Db, adminAuthzUser: AuthzUser, referralId: string) {
  const decision = can(adminAuthzUser, { type: "read_referral_outcomes_as_admin" });
  if (!decision.allowed) throw new Error(decision.reason);

  const rows = await listReferralOutcomeTimeline(db, referralId);

  await writeAuditLog(db, {
    actorUserId: adminAuthzUser.id,
    actingContext: "admin",
    action: "referral_outcomes_read",
    targetTable: "referral_status_updates",
    targetId: referralId,
    outcome: "success",
  });

  return rows;
}

/**
 * §10 — "Referrals I raised — each row shows the latest outcome." One
 * query for the whole board list rather than N+1 per card. Returns only
 * referrals that have at least one (non-deleted) status update; a
 * referral with none simply has no entry in the map, same as "no
 * matched referrals" elsewhere on the board.
 */
export async function listLatestOutcomes(
  db: Db,
  referralIds: string[],
): Promise<Map<string, { outcome: string; createdAt: Date }>> {
  if (referralIds.length === 0) return new Map();

  const rows = await db
    .select({
      referralId: referralStatusUpdates.referralId,
      outcome: referralStatusUpdates.outcome,
      createdAt: referralStatusUpdates.createdAt,
    })
    .from(referralStatusUpdates)
    .where(and(inArray(referralStatusUpdates.referralId, referralIds), isNull(referralStatusUpdates.deletedAt)))
    .orderBy(desc(referralStatusUpdates.createdAt));

  // Rows arrive newest-first; keep only the first (latest) one seen per
  // referral rather than a second query or a window function.
  const latest = new Map<string, { outcome: string; createdAt: Date }>();
  for (const row of rows) {
    if (!latest.has(row.referralId)) {
      latest.set(row.referralId, { outcome: row.outcome, createdAt: row.createdAt });
    }
  }
  return latest;
}

const BACKSTOP_CLOSE_AFTER_DAYS = 45;

/**
 * §G's timer discipline + this addendum's execution-plan correction:
 * closes a referral stuck at 'accepted' for 45+ days with ZERO status
 * updates — a therapist who reported 'ongoing' is not a lost loop (a
 * neuro-rehab episode can legitimately run months), so this only ever
 * fires on silence. Uses 'auto_closed', never 'completed': an
 * auto-closure is an unknown outcome, and counting it as a completion
 * would corrupt weekly-digest and the §12 metrics. Folds into the
 * existing daily retention cron route rather than a 6th Cloudflare Cron
 * Trigger — same precedent as credential-expiry.ts.
 */
export async function closeStaleAcceptedReferrals(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - BACKSTOP_CLOSE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .update(homeCaseReferrals)
    .set({ status: "auto_closed", updatedAt: new Date() })
    .where(
      and(
        eq(homeCaseReferrals.status, "accepted"),
        lt(homeCaseReferrals.acceptedAt, cutoff),
        sql`NOT EXISTS (
          SELECT 1 FROM ${referralStatusUpdates}
          WHERE ${referralStatusUpdates.referralId} = ${homeCaseReferrals.id}
            AND ${referralStatusUpdates.deletedAt} IS NULL
        )`,
      ),
    )
    .returning({ id: homeCaseReferrals.id });

  if (rows.length > 0) {
    await db.insert(referralEvents).values(
      rows.map((r) => ({ referralId: r.id, eventType: "auto_closed", payload: { reason: "no_status_update_45d" } })),
    );
  }

  return rows.length;
}
