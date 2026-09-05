// §8H — data export, "background job, 24-hour presigned link." Assembles
// a JSON bundle of a user's own data, writes it to the private R2
// credentials bucket, and enqueues an email (via notification_outbox,
// never sent inline) carrying a 24-hour presigned download link.
//
// Documents (credential/practice-claim files) are NOT included in the
// bundle itself — they're already the user's own uploads, and re-bundling
// them would duplicate a private R2 object into a second, less-controlled
// one. The bundle links a document by its existing object key instead;
// only an admin with document access can resolve that further.

import { eq } from "drizzle-orm";
import {
  credentials,
  feedback,
  homeCaseReferrals,
  invites,
  notificationOutbox,
  practiceClaims,
  referralInterest,
  users,
} from "@/db/schema";
import type { getDb } from "@/db/db";
import { CREDENTIALS_BUCKET, putR2Object, type R2Env } from "./r2";
import { createPresignedDownloadUrl } from "./r2-presign";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface DataExportResult {
  objectKey: string;
  downloadUrl: string;
}

async function assembleExportBundle(db: Db, userId: string): Promise<Record<string, unknown>> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      legalName: users.legalName,
      displayName: users.displayName,
      accountType: users.accountType,
      role: users.role,
      specializations: users.specializations,
      bio: users.bio,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  const [credentialRows, referralsPosted, referralInterestRows, practiceClaimRows, feedbackRows, inviteRows] =
    await Promise.all([
      db
        .select({
          id: credentials.id,
          type: credentials.type,
          status: credentials.status,
          verifiedAt: credentials.verifiedAt,
          documentUrl: credentials.documentUrl,
        })
        .from(credentials)
        .where(eq(credentials.userId, userId)),
      db
        .select({ id: homeCaseReferrals.id, status: homeCaseReferrals.status, createdAt: homeCaseReferrals.createdAt })
        .from(homeCaseReferrals)
        .where(eq(homeCaseReferrals.postedByUserId, userId)),
      db
        .select({ id: referralInterest.id, referralId: referralInterest.referralId, status: referralInterest.status })
        .from(referralInterest)
        .where(eq(referralInterest.therapistUserId, userId)),
      db
        .select({ id: practiceClaims.id, status: practiceClaims.status, createdAt: practiceClaims.createdAt })
        .from(practiceClaims)
        .where(eq(practiceClaims.claimantUserId, userId)),
      db
        .select({ id: feedback.id, category: feedback.category, status: feedback.status, createdAt: feedback.createdAt })
        .from(feedback)
        .where(eq(feedback.userId, userId)),
      db
        .select({ id: invites.id, channel: invites.channel, createdAt: invites.createdAt })
        .from(invites)
        .where(eq(invites.inviterUserId, userId)),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: user ?? null,
    credentials: credentialRows,
    referralsPosted,
    referralInterest: referralInterestRows,
    practiceClaims: practiceClaimRows,
    feedback: feedbackRows,
    invites: inviteRows,
  };
}

/**
 * Builds the bundle, uploads it to R2, and enqueues the email carrying the
 * link — the enqueue is the only DB write here that matters for delivery;
 * the actual send happens out-of-band via the existing notification-outbox
 * worker, same as every other notification (never sent inline).
 */
export async function requestDataExportTx(db: Db, env: R2Env, userId: string): Promise<DataExportResult> {
  const bundle = await assembleExportBundle(db, userId);
  const objectKey = `exports/${userId}/${Date.now()}-${crypto.randomUUID()}.json`;

  await putR2Object(env, CREDENTIALS_BUCKET, objectKey, JSON.stringify(bundle, null, 2), "application/json");
  const downloadUrl = await createPresignedDownloadUrl(env, CREDENTIALS_BUCKET, objectKey);

  await db.insert(notificationOutbox).values({
    userId,
    channel: "email",
    template: "data_export_ready",
    payload: { url: downloadUrl },
  });

  return { objectKey, downloadUrl };
}
