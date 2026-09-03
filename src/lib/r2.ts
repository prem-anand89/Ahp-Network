// THE single R2 client setup file. Per CLAUDE.md's non-negotiable: R2
// access always goes through R2's standard S3-compatible API, never
// Cloudflare's native binding API (env.MY_BUCKET.put(...)) — this is the
// single decision that most determines how expensive a future hosting move
// away from Workers would be, since the same client code below runs
// unchanged on Workers, Railway, Vercel, or a VPS.
//
// Two buckets, per BUILD_SEQUENCE.md Phase 0:
//   - ahp-network-credentials — private, credential documents (OCR review)
//   - ahp-network-photos      — public via CDN, profile photos
//
// Access keys and account ID come from Cloudflare Workers Secrets at
// runtime (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) —
// never hardcoded, never committed. Generate the R2 API token's access
// keys from the Cloudflare dashboard (R2 → Manage API Tokens); the account
// ID is visible on any R2 bucket's overview page.

import { S3Client } from "@aws-sdk/client-s3";

export const CREDENTIALS_BUCKET = "ahp-network-credentials";
export const PHOTOS_BUCKET = "ahp-network-photos";

let cached: S3Client | undefined;

export function getR2Client(env: {
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}): S3Client {
  if (cached) return cached;

  cached = new S3Client({
    region: "auto",
    endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  return cached;
}
