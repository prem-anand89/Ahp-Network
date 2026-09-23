"use server";

// The Phase 3 verification queue's admin actions — Approve / Raise query /
// Reject (plan §8A). Gated via requireAdminAccess (manage_curation_queue).

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { credentials } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { createPresignedCredentialViewUrl } from "@/lib/r2-presign";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { RegistrationNumberMismatchError } from "@/lib/registration-number-mismatch-error";
import { registrationNumberMatches } from "@/lib/registration-number-confirm";

// R2 access-key secrets are Workers Secrets — see verification/actions.ts
// (the therapist-facing upload path) for why this interface exists rather
// than reading process.env/CloudflareEnv directly.
interface R2SecretsEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

// Phase 1 step 15 — minimal admin document viewer. Audited BEFORE
// returning the URL, per CLAUDE.md's "admin reads of patient contact data
// are audited, not just mutations" — the same discipline applied here to
// credential documents, which carry identity documents, not just contact
// info. Never a public URL, never a long TTL, never a shareable proxy
// route — the presign itself expires in 120s (r2-presign.ts).
export async function getCredentialDocumentViewUrl(credentialId: string): Promise<string> {
  const { db, userId } = await requireAdminAccess({ type: "manage_curation_queue" });

  const [credential] = await db
    .select({ documentUrl: credentials.documentUrl })
    .from(credentials)
    .where(eq(credentials.id, credentialId));
  if (!credential?.documentUrl) throw new Error("No document on file for this credential");

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "credential_document_viewed",
    targetTable: "credentials",
    targetId: credentialId,
    outcome: "success",
  });

  const env = await getRuntimeEnv<R2SecretsEnv>();
  return createPresignedCredentialViewUrl(env, credential.documentUrl);
}

// Phase 4 — "did you actually look?" as a mechanism, not a question.
// Deferred from Phase 1 with the rest of the credential loop. An admin
// must re-type the registration number exactly before approve succeeds —
// checked server-side against credentials.registration_number, never
// trusted from a hidden field the client could tamper with. Credentials
// with no registration number on file (most degrees/postgraduate
// degrees) have nothing to re-type, so the check is a no-op for those —
// this mechanism is specifically about the number, not a generic
// confirmation dialog. RegistrationNumberMismatchError itself lives in
// lib/registration-number-mismatch-error.ts, not here — see that file.
export type DocumentKind = "degree_certificate" | "provisional_certificate" | "course_completion" | "bonafide";

const DOCUMENT_KIND_VALUES: readonly DocumentKind[] = [
  "degree_certificate",
  "provisional_certificate",
  "course_completion",
  "bonafide",
];

export async function approveCredential(
  credentialId: string,
  typedRegistrationNumber?: string,
  documentKind?: string,
) {
  const { db, userId, adminUserId } = await requireAdminAccess({ type: "manage_curation_queue" });

  const [existing] = await db
    .select({ registrationNumber: credentials.registrationNumber, type: credentials.type })
    .from(credentials)
    .where(eq(credentials.id, credentialId));

  if (!registrationNumberMatches(existing?.registrationNumber ?? null, typedRegistrationNumber)) {
    await writeAuditLog(db, {
      actorUserId: userId,
      actingContext: "admin",
      action: "credential_approved",
      targetTable: "credentials",
      targetId: credentialId,
      outcome: "failure",
      afterState: { reason: "registration_number_mismatch" },
    });
    throw new RegistrationNumberMismatchError();
  }

  // document_kind only makes sense (and is only DB-permitted, per
  // credentials_document_kind_type_check) on the qualification side —
  // council_registration is always a registration, nothing to classify.
  const isQualificationDoc = existing?.type === "degree" || existing?.type === "postgraduate_degree";
  const resolvedDocumentKind =
    isQualificationDoc && documentKind && (DOCUMENT_KIND_VALUES as readonly string[]).includes(documentKind)
      ? (documentKind as DocumentKind)
      : undefined;
  if (isQualificationDoc && !resolvedDocumentKind) {
    throw new Error("Choose what kind of document this is before approving.");
  }

  const [credential] = await db
    .update(credentials)
    .set({
      status: "approved",
      verifiedBy: adminUserId,
      verifiedAt: new Date(),
      updatedAt: new Date(),
      ...(resolvedDocumentKind ? { documentKind: resolvedDocumentKind } : {}),
    })
    .where(eq(credentials.id, credentialId))
    .returning({ userId: credentials.userId });

  await db.execute(sql`SELECT sync_degree_to_course_completion(${credentialId})`);
  await db.execute(sql`SELECT recompute_verification_stage(${credential.userId})`);

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "credential_approved",
    targetTable: "credentials",
    targetId: credentialId,
    outcome: "success",
    afterState: { status: "approved", documentKind: resolvedDocumentKind ?? null },
  });

  revalidatePath("/admin/verification");
}

export async function rejectCredential(credentialId: string) {
  const { db, userId, adminUserId } = await requireAdminAccess({ type: "manage_curation_queue" });

  const [credential] = await db
    .update(credentials)
    .set({ status: "rejected", verifiedBy: adminUserId, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(credentials.id, credentialId))
    .returning({ userId: credentials.userId });

  await db.execute(sql`SELECT recompute_verification_stage(${credential.userId})`);

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "credential_rejected",
    targetTable: "credentials",
    targetId: credentialId,
    outcome: "success",
    afterState: { status: "rejected" },
  });

  revalidatePath("/admin/verification");
}

export async function raiseCredentialQuery(credentialId: string, message: string) {
  const { db, userId, adminUserId } = await requireAdminAccess({ type: "manage_curation_queue" });

  await db
    .update(credentials)
    .set({
      status: "query_raised",
      queryMessage: message,
      queryRaisedAt: new Date(),
      queryRaisedByAdminId: adminUserId,
      updatedAt: new Date(),
    })
    .where(eq(credentials.id, credentialId));

  await writeAuditLog(db, {
    actorUserId: userId,
    actingContext: "admin",
    action: "credential_query_raised",
    targetTable: "credentials",
    targetId: credentialId,
    outcome: "success",
    // No raw PII, per audit.ts's discipline — a change-happened marker,
    // not the query text itself.
    afterState: { status: "query_raised" },
  });

  revalidatePath("/admin/verification");
}
