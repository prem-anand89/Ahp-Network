// §8A1a / CLAUDE.md non-negotiable: recompute_verification_stage() is the
// ONLY writer of users.verification_stage, called from exactly two places —
// the admin approve/reject action, and this job. Without this job, a
// therapist's council registration passing its expiry_date never caused
// verification_stage to react: the function already excludes expired
// credentials from its checks (drizzle/0010), but nothing ever called it
// again after the original approval to notice a credential had since
// expired. A stale 'credentials_verified' stage keeps granting
// patient_summary/referral-claim access on an expired registration
// indefinitely.
//
// Runs daily, folded into the existing retention cron route rather than a
// new Cron Trigger — Cloudflare's free-tier account budget is 5 triggers
// and the existing five daily/sub-hourly jobs already use it in full (see
// wrangler.jsonc). Credential expiry is a day/month-scale concern, the same
// cadence as retention, so sharing that trigger costs nothing in
// timeliness.

import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Recomputes verification_stage for every user with an approved,
 * non-deleted degree/postgraduate_degree/council_registration credential
 * whose expiry_date has passed — the only credential types
 * recompute_verification_stage() actually checks — and who isn't already
 * 'unverified' (recomputing them would be a no-op). Safe to run repeatedly:
 * recompute_verification_stage() always recalculates the full stage from
 * current state, so a user with another still-valid credential covering the
 * same tier is simply left unchanged.
 */
export async function recomputeExpiredVerificationStages(db: Db): Promise<{ usersRecomputed: number }> {
  const affected = await db.$client<{ user_id: string }[]>`
    SELECT DISTINCT c.user_id
    FROM credentials c
    JOIN users u ON u.id = c.user_id
    WHERE c.status = 'approved'
      AND c.deleted_at IS NULL
      AND c.type IN ('degree', 'postgraduate_degree', 'council_registration')
      AND c.expiry_date IS NOT NULL
      AND c.expiry_date <= now()
      AND u.verification_stage != 'unverified'`;

  for (const row of affected) {
    await db.$client`SELECT recompute_verification_stage(${row.user_id})`;
  }

  return { usersRecomputed: affected.length };
}
