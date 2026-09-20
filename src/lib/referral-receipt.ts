// Phase 5 — the referral receipt. On completion both parties get a
// shareable, printable one-pager identified by a public_ref_code
// (R-YYYY-NNNN). Hard rule: per-referral, never per-person — nothing in
// this file counts receipts per user or exposes a total anywhere; "you've
// completed 7" on any public surface is exactly the comparison §1A bans.
// Answers "why come back?" with a record of one specific professional
// handoff, not a streak or a point total (reciprocity.ts already covers
// the private, self-only version of that number).

import { and, eq, isNull, sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { areas, homeCaseReferrals, referralInterest, referralStatusUpdates, users } from "@/db/schema";
import type * as schema from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;
// generatePublicRefCode is called from inside reportOutcomeTx's
// db.transaction() callback (referral-outcomes.ts), so it needs to
// accept the transaction handle drizzle hands that callback, not just a
// the outer Db — the two are different TS types even though both
// support the same .select()/.update() calls this file makes.
type DbOrTx = Db | PgTransaction<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

const MAX_GENERATION_ATTEMPTS = 5;

/** Called only from inside reportOutcomeTx's transaction, only when a
 * referral has just actually transitioned to 'completed' — never
 * speculatively. NNNN is a per-year sequential count, not a global one
 * (R-2026-0001, R-2027-0001, ...) — a retry loop against the unique
 * index is the actual correctness mechanism under concurrent completions
 * at pilot scale, not the count query, which is only a good first guess. */
export async function generatePublicRefCode(tx: DbOrTx): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `R-${year}-`;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(homeCaseReferrals)
      .where(sql`${homeCaseReferrals.publicRefCode} LIKE ${prefix + "%"}`);

    const candidate = `${prefix}${String(count + 1 + attempt).padStart(4, "0")}`;

    const [existing] = await tx
      .select({ id: homeCaseReferrals.id })
      .from(homeCaseReferrals)
      .where(eq(homeCaseReferrals.publicRefCode, candidate));
    if (!existing) return candidate;
  }

  // Astronomically unlikely at pilot scale (would need
  // MAX_GENERATION_ATTEMPTS genuinely concurrent completions in the same
  // year) — fail loudly rather than silently reuse or skip a code.
  throw new Error("Could not generate a unique referral receipt code");
}

export interface ReceiptData {
  publicRefCode: string;
  specializationNeeded: string;
  localityName: string | null;
  completedAt: Date;
  posterDisplayName: string | null;
  accepterDisplayName: string | null;
  outcome: string | null;
}

/** The only read path the public receipt page uses — selects exactly the
 * fields the printed one-pager shows, structured facts only, never
 * patient_summary or any other patient-identifying column. */
export async function getReceiptByCode(db: Db, code: string): Promise<ReceiptData | null> {
  const [referral] = await db
    .select({
      id: homeCaseReferrals.id,
      publicRefCode: homeCaseReferrals.publicRefCode,
      specializationNeeded: homeCaseReferrals.specializationNeeded,
      postedByUserId: homeCaseReferrals.postedByUserId,
      updatedAt: homeCaseReferrals.updatedAt,
      areaId: homeCaseReferrals.areaId,
    })
    .from(homeCaseReferrals)
    .where(and(eq(homeCaseReferrals.publicRefCode, code), isNull(homeCaseReferrals.deletedAt)));
  if (!referral) return null;

  const [posterRow, accepterRow, localityRow, latestOutcomeRow] = await Promise.all([
    db.select({ displayName: users.displayName }).from(users).where(eq(users.id, referral.postedByUserId)),
    db
      .select({ displayName: users.displayName })
      .from(referralInterest)
      .innerJoin(users, eq(users.id, referralInterest.therapistUserId))
      .where(and(eq(referralInterest.referralId, referral.id), eq(referralInterest.status, "accepted"))),
    referral.areaId
      ? db.select({ name: areas.name }).from(areas).where(eq(areas.id, referral.areaId))
      : Promise.resolve([]),
    db
      .select({ outcome: referralStatusUpdates.outcome, createdAt: referralStatusUpdates.createdAt })
      .from(referralStatusUpdates)
      .where(eq(referralStatusUpdates.referralId, referral.id))
      .orderBy(sql`${referralStatusUpdates.createdAt} DESC`)
      .limit(1),
  ]);

  return {
    publicRefCode: referral.publicRefCode!,
    specializationNeeded: referral.specializationNeeded,
    localityName: localityRow[0]?.name ?? null,
    completedAt: referral.updatedAt,
    posterDisplayName: posterRow[0]?.displayName ?? null,
    accepterDisplayName: accepterRow[0]?.displayName ?? null,
    outcome: latestOutcomeRow[0]?.outcome ?? null,
  };
}
