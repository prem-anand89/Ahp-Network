// §8A2's pipeline, orchestrated: Upload -> Vision OCR -> confidence
// check -> institution fuzzy-match -> admin queue, prioritised by
// confidence -- never auto-approved at any point in this chain. This function is the
// one place that chain is wired together; nothing here writes
// credentials.status to 'approved'/'rejected' or touches
// users.verification_stage.
//
// Fully async by design (plan §8A2: "the user never waits on it") --
// called via ctx.waitUntil from the submission action, never awaited by
// the request that returns to the browser.

import { eq } from "drizzle-orm";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, CREDENTIALS_BUCKET } from "@/lib/r2";
import { extractText, type VisionServiceAccountKey } from "./vision";
import { scoreCredential } from "@/lib/credential-scoring";
import { matchOrQueueInstitution } from "@/lib/institution-match";
import type { getDb } from "@/db/db";
import { credentials, masterCouncils, users } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

interface R2Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

async function objectToBase64(env: R2Env, objectKey: string): Promise<string> {
  const client = getR2Client(env);
  const { Body } = await client.send(
    new GetObjectCommand({ Bucket: CREDENTIALS_BUCKET, Key: objectKey }),
  );
  const bytes = await Body!.transformToByteArray();
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/**
 * Runs OCR + scoring + institution matching for one just-uploaded
 * credential and writes the result — never advancing status past
 * 'under_review'. A failure at any step still leaves the credential in the
 * queue (as 'pending', unscored) rather than losing the submission --
 * the admin can review the raw document either way, OCR is assistance,
 * not a gate (plan §8A2).
 */
export async function processCredentialOcr(
  db: Db,
  env: R2Env,
  visionKey: VisionServiceAccountKey,
  credentialId: string,
): Promise<void> {
  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.id, credentialId));

  if (!credential || !credential.documentUrl) return;

  const [user] = await db.select().from(users).where(eq(users.id, credential.userId));

  try {
    const imageBase64 = await objectToBase64(env, credential.documentUrl);
    const { fullText, raw } = await extractText(visionKey, imageBase64);

    let council = null;
    if (credential.councilId) {
      [council] = await db
        .select()
        .from(masterCouncils)
        .where(eq(masterCouncils.id, credential.councilId));
    }

    // Naive extraction from the raw text — a real implementation tunes
    // this per document layout during the pre-launch validation pass
    // (15-20 real documents, §8A2). What matters for this phase is that
    // the pipeline's shape (confidence -> queue priority, never a gate) is
    // correct and testable independent of extraction quality.
    const extractedName = fullText.split("\n")[0]?.trim() ?? null;
    const registrationMatch = credential.registrationNumber
      ? fullText.includes(credential.registrationNumber)
        ? credential.registrationNumber
        : null
      : null;

    const { confidenceScore } = scoreCredential({
      legalName: user?.legalName ?? "",
      ocrExtractedName: extractedName,
      ocrExtractedRegistrationNumber: registrationMatch,
      registrationNumberPattern: council?.registrationNumberPattern ?? null,
      expiryDate: credential.expiryDate,
    });

    let institutionId = credential.institutionId;
    if (!institutionId && credential.type !== "council_registration" && extractedName) {
      const match = await matchOrQueueInstitution(db, extractedName, null);
      institutionId = match.institutionId;
    }

    await db
      .update(credentials)
      .set({
        ocrExtractedJson: raw as object,
        confidenceScore,
        institutionId,
        status: "under_review",
        updatedAt: new Date(),
      })
      .where(eq(credentials.id, credentialId));
  } catch (err) {
    // OCR is assistance, never a gate — a Vision failure (including the
    // real possibility this call has never succeeded against the live API,
    // see src/lib/ocr/vision.ts's honesty note) must not lose the
    // submission. It stays 'pending' and unscored, at the bottom of
    // priority ordering, still fully reviewable by an admin.
    console.error(`OCR processing failed for credential ${credentialId}:`, err);
  }
}
