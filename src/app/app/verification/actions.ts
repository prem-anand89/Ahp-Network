"use server";

// Therapist-facing credential submission — plan §8A/§8A2. Lives under
// /app/*, never /admin/* (CLAUDE.md's route-segment split).
//
// §10F (Phase 8) also added createShareLink here — the celebration
// screen's Share/Invite actions. Both go through the same §8A4 invite
// mechanism (rate-limited, no address-book access); Share is just an
// invite logged with channel 'copy_link'.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/db";
import { credentials, users } from "@/db/schema";
import { createPresignedUploadUrl } from "@/lib/r2-presign";
import { processCredentialOcr } from "@/lib/ocr/process-credential";
import { createInviteTx } from "@/lib/invites";
import { requireAuthUserId, requireEditOwnProfile } from "@/lib/require-session";

// R2 access-key secrets and the GCP Vision service-account key are
// Workers Secrets (never in wrangler.jsonc's `vars`, so they don't appear
// in the generated CloudflareEnv type) — see src/lib/r2.ts's header
// comment and this file's OCR-triggering comment below.
interface SecretsEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  GCP_VISION_SERVICE_ACCOUNT_KEY?: string;
}

export async function requestCredentialUploadUrl(contentType: string) {
  const { userId } = await requireEditOwnProfile();
  const { env } = await getCloudflareContext({ async: true });
  const objectKey = `credentials/${userId}/${crypto.randomUUID()}`;

  const url = await createPresignedUploadUrl(env as unknown as SecretsEnv, {
    kind: "credential_document",
    contentType,
    objectKey,
  });

  return { url, objectKey };
}

export interface SubmitCredentialInput {
  type: "degree" | "postgraduate_degree" | "council_registration";
  objectKey: string;
  registrationNumber?: string;
  institutionId?: string;
  councilId?: string;
  expiryDate?: string; // ISO date
}

export async function submitCredential(input: SubmitCredentialInput) {
  const { userId, db } = await requireEditOwnProfile();

  if (input.type === "council_registration" && !input.councilId) {
    throw new Error("A council must be selected for a council registration credential");
  }

  const { env, ctx } = await getCloudflareContext({ async: true });

  const [credential] = await db
    .insert(credentials)
    .values({
      userId,
      type: input.type,
      documentUrl: input.objectKey,
      registrationNumber: input.registrationNumber,
      institutionId: input.institutionId,
      councilId: input.type === "council_registration" ? input.councilId : undefined,
      expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
      status: "pending",
    })
    .returning({ id: credentials.id });

  const secretsEnv = env as unknown as SecretsEnv;
  if (secretsEnv.GCP_VISION_SERVICE_ACCOUNT_KEY) {
    const visionKey = JSON.parse(secretsEnv.GCP_VISION_SERVICE_ACCOUNT_KEY);
    ctx.waitUntil(processCredentialOcr(db, secretsEnv, visionKey, credential.id));
  }

  return { id: credential.id };
}

/** §10F — builds `ahpnetwork.in/pt/[slug]?ref=[code]` for either the Share or Invite action. */
export async function createShareLink(channel: "whatsapp" | "copy_link"): Promise<string> {
  const userId = await requireAuthUserId();
  const db = await getDb();

  const [me] = await db.select({ slug: users.slug }).from(users).where(eq(users.id, userId));
  const { code } = await createInviteTx(db, { inviterUserId: userId, channel });

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ahpnetwork.in";
  return `${base}/pt/${me?.slug ?? ""}?ref=${code}`;
}
