// §7 — "short-lived signed R2 upload URLs, browser uploads directly to
// R2." Generates a presigned PUT URL via R2's S3-compatible API (never the
// native binding), scoped to one object key, one content-type, and a short
// expiry — the browser uploads straight to R2 with this URL, the Worker
// never proxies the file bytes through itself.

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, CREDENTIALS_BUCKET, PHOTOS_BUCKET } from "./r2";
import { allowedMimeTypesFor, maxBytesFor, type UploadKind } from "./upload-validation";

const PRESIGN_EXPIRY_SECONDS = 5 * 60; // short-lived, per §7

interface R2Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

export interface PresignRequest {
  kind: UploadKind;
  contentType: string;
  objectKey: string;
}

export async function createPresignedUploadUrl(
  env: R2Env,
  { kind, contentType, objectKey }: PresignRequest,
): Promise<string> {
  const allowed = allowedMimeTypesFor(kind);
  if (!allowed.has(contentType)) {
    throw new Error(`Content-Type ${contentType} is not allowed for ${kind}`);
  }

  const bucket = kind === "photo" ? PHOTOS_BUCKET : CREDENTIALS_BUCKET;
  const client = getR2Client(env);

  // Size isn't enforceable in the presigned URL itself — re-validated
  // server-side (magic bytes + size cap, src/lib/upload-validation.ts)
  // after upload completes, before the object is considered accepted.
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });
}

export { maxBytesFor };
