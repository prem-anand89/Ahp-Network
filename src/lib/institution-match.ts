// §8B2 — fuzzy-match an OCR-extracted (or self-entered) institution name
// against master_institutions.normalized_name using pg_trgm similarity,
// the same technique already used for legal-name matching. A match links
// credentials.institution_id automatically; no match inserts a
// pending_review row for the curation queue (drizzle/0007's
// master_institutions.curation_status) — NEVER auto-create an approved
// row from an unreviewed match, same discipline as practice dedup and
// course curation.

import { sql } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { masterInstitutions } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

const SIMILARITY_THRESHOLD = 0.4;

export function normalizeInstitutionName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(college|institute|university|of|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface InstitutionMatchResult {
  institutionId: string | null;
  /** True when a new pending_review row was inserted for the curation queue. */
  enteredCurationQueue: boolean;
}

/**
 * Returns an existing institution's id on a confident fuzzy match, or
 * inserts a pending_review row for admin curation (curation-queue UI:
 * src/app/admin/(protected)/curation/institutions) — never both, and
 * never an auto-approved row either way.
 */
export async function matchOrQueueInstitution(
  db: Db,
  rawName: string,
  city: string | null,
): Promise<InstitutionMatchResult> {
  const normalized = normalizeInstitutionName(rawName);
  if (normalized.length === 0) {
    return { institutionId: null, enteredCurationQueue: false };
  }

  const [closestMatch] = await db
    .select({
      id: masterInstitutions.id,
      similarity: sql<number>`similarity(${masterInstitutions.normalizedName}, ${normalized})`,
    })
    .from(masterInstitutions)
    .where(sql`similarity(${masterInstitutions.normalizedName}, ${normalized}) > ${SIMILARITY_THRESHOLD}`)
    .orderBy(sql`similarity(${masterInstitutions.normalizedName}, ${normalized}) DESC`)
    .limit(1);

  if (closestMatch) {
    return { institutionId: closestMatch.id, enteredCurationQueue: false };
  }

  const [created] = await db
    .insert(masterInstitutions)
    .values({
      name: rawName.trim(),
      city,
      normalizedName: normalized,
      curationStatus: "pending_review",
    })
    .returning({ id: masterInstitutions.id });

  return { institutionId: created.id, enteredCurationQueue: true };
}
