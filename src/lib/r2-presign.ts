// §7 — "short-lived signed R2 upload URLs, browser uploads directly to
// R2." Generates a presigned PUT URL via R2's S3-compatible API (never the
// native binding), scoped to one object key and a short expiry — the
// browser uploads straight to R2 with this URL, the Worker never proxies
// the file bytes through itself.
//
// SigV4 presigning is query-string signing: X-Amz-Expires is itself a
// signed parameter, so it's set on the URL *before* calling client.sign
// with signQuery — aws4fetch doesn't take an "expiresIn" option, it just
// faithfully implements the spec on whatever query string you hand it.
// Content-Type is deliberately left unsigned (browsers vary in what they
// send); the upload is re-validated server-side by magic bytes + size cap
// after it completes regardless (src/lib/upload-validation.ts).

import { getR2Client, r2ObjectUrl, CREDENTIALS_BUCKET, PHOTOS_BUCKET, type R2Env } from "./r2";
import { allowedMimeTypesFor, maxBytesFor, type UploadKind } from "./upload-validation";

const PRESIGN_EXPIRY_SECONDS = 5 * 60; // short-lived, per §7

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
  const { client } = getR2Client(env);

  const url = new URL(r2ObjectUrl(env, bucket, objectKey));
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRY_SECONDS));

  const signed = await client.sign(url.toString(), {
    method: "PUT",
    aws: { signQuery: true },
  });

  return signed.url;
}

// §8H data export — "a real bundle via a working presigned-link email
// flow," 24 hours. A GET presign, not the upload PUT presign above:
// the export bundle is server-generated (r2.ts's putR2Object), never
// browser-uploaded, so this is the read side only.
const EXPORT_DOWNLOAD_EXPIRY_SECONDS = 24 * 60 * 60;

export async function createPresignedDownloadUrl(env: R2Env, bucket: string, objectKey: string): Promise<string> {
  const { client } = getR2Client(env);

  const url = new URL(r2ObjectUrl(env, bucket, objectKey));
  url.searchParams.set("X-Amz-Expires", String(EXPORT_DOWNLOAD_EXPIRY_SECONDS));

  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });

  return signed.url;
}

export { maxBytesFor };
