// §8C — practice deduplication. google_place_id is the primary uniqueness
// key (enforced by a partial unique index, drizzle/0013); this is the
// secondary path for when Places has no listing for a place, or multiple
// pins exist for the same real place. NEVER auto-merge on a match here —
// a match only sets possible_duplicate_of and surfaces the row in the
// admin queue.

import { and, eq, isNull, or } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { practices } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

export function normalizePracticeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePracticeAddress(address: string): string {
  return address
    .trim()
    .toLowerCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds an existing, non-deleted practice that looks like the same real
 * place: either the same google_place_id, or the same normalized
 * name+address pair. Returns its id, or null if nothing matches.
 */
export async function findDuplicatePractice(
  db: Db,
  input: { googlePlaceId: string | null; normalizedName: string; normalizedAddress: string },
): Promise<string | null> {
  const conditions = [
    and(eq(practices.normalizedName, input.normalizedName), eq(practices.normalizedAddress, input.normalizedAddress)),
  ];
  if (input.googlePlaceId) {
    conditions.push(eq(practices.googlePlaceId, input.googlePlaceId));
  }

  const [match] = await db
    .select({ id: practices.id })
    .from(practices)
    .where(and(isNull(practices.deletedAt), or(...conditions)))
    .limit(1);

  return match?.id ?? null;
}
