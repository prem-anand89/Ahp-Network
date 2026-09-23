// Phase 3 — the Public Verification Record. "This is the product thesis,
// today rendered as a 90×24px chip." Read-only display, same discipline
// as profile-card.ts: never writes verification_stage or anything else
// recompute_verification_stage() owns.
//
// Privacy call, explicit (plan's own wording): shows council, document
// type, date and registration number — NEVER the document itself, NEVER
// ocr_extracted_json, NEVER legal_name. The registration number is
// already public on the council's own register, which is both the
// justification for showing it here and what makes this record
// independently checkable — that's the whole point of the page.

import { and, eq, isNull } from "drizzle-orm";
import { credentials, masterCouncils, masterInstitutions } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface VerificationRecordEntry {
  id: string;
  type: "degree" | "postgraduate_degree" | "council_registration";
  documentKind: "degree_certificate" | "provisional_certificate" | "course_completion" | "bonafide" | null;
  councilName: string | null;
  councilType: "statutory_registration" | "professional_association" | null;
  institutionName: string | null;
  registrationNumber: string | null;
  verifiedAt: Date | null;
}

/** Every approved, non-opted-out credential for this user — the caller
 * decides how to group/label them (see the page for the type -> label
 * mapping, kept out of this query so it stays reusable). Empty array is
 * a real, valid state (an unverified or opted-out-of-everything profile),
 * not an error. */
export async function getPublicVerificationRecord(db: Db, userId: string): Promise<VerificationRecordEntry[]> {
  const rows = await db
    .select({
      id: credentials.id,
      type: credentials.type,
      documentKind: credentials.documentKind,
      councilName: masterCouncils.name,
      councilType: masterCouncils.councilType,
      institutionName: masterInstitutions.name,
      registrationNumber: credentials.registrationNumber,
      verifiedAt: credentials.verifiedAt,
    })
    .from(credentials)
    .leftJoin(masterCouncils, eq(masterCouncils.id, credentials.councilId))
    .leftJoin(masterInstitutions, eq(masterInstitutions.id, credentials.institutionId))
    .where(
      and(
        eq(credentials.userId, userId),
        eq(credentials.status, "approved"),
        eq(credentials.publicRecordVisible, true),
        isNull(credentials.deletedAt),
      ),
    )
    .orderBy(credentials.verifiedAt);

  return rows;
}
