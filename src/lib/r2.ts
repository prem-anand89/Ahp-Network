// THE single R2 client setup file. Per CLAUDE.md's non-negotiable: R2
// access always goes through R2's standard S3-compatible API, never
// Cloudflare's native binding API (env.MY_BUCKET.put(...)) — this is the
// single decision that most determines how expensive a future hosting move
// away from Workers would be, since the same client code below runs
// unchanged on Workers, Railway, Vercel, or a VPS.
//
// Uses aws4fetch (a ~5KB SigV4 request signer built for edge runtimes)
// instead of the full @aws-sdk/client-s3 — the AWS SDK pulls in XML
// parsers, a credential-provider chain, and a retry/middleware stack sized
// for AWS's whole API surface, none of which this app uses: we only ever
// talk to one known R2 endpoint with one known key pair, doing plain
// GET/PUT/multipart-upload calls. That SDK weight was a large, avoidable
// contributor to the Worker exceeding Cloudflare's free-tier 3 MiB bundle
// size limit. aws4fetch signs a request and hands back a plain Request/
// fetch call — no command objects, no XML response parsing built in (that
// part is done by hand in r2-multipart.ts and process-credential.ts).
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

import { AwsClient } from "aws4fetch";

export const CREDENTIALS_BUCKET = "ahp-network-credentials";
export const PHOTOS_BUCKET = "ahp-network-photos";

export interface R2Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

export interface R2Client {
  client: AwsClient;
  endpoint: string;
}

let cached: R2Client | undefined;

export function getR2Client(env: R2Env): R2Client {
  if (cached) return cached;

  cached = {
    client: new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    }),
    endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };

  return cached;
}

// Encodes each path segment separately so a key like "users/abc/x.pdf"
// keeps its "/" separators instead of becoming one opaque segment.
export function r2ObjectUrl(env: R2Env, bucket: string, key: string): string {
  const { endpoint } = getR2Client(env);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/${bucket}/${encodedKey}`;
}

// The one piece of AWS SDK behavior deliberately reintroduced after the
// aws4fetch swap: the SDK auto-retried transient failures (a momentary R2
// 5xx, a dropped connection) with backoff; a bare client.fetch() does not.
// This is intentionally minimal — one retry, a short fixed delay, never on
// a 4xx (a bad signature or missing object won't fix itself) and never
// after the caller's own AbortSignal has fired (that's a cancellation, not
// a failure to recover from).
const RETRY_DELAY_MS = 250;

/** Uploads a server-generated object directly (never a browser upload —
 * those go through r2-presign.ts's presigned PUT instead). Used by the
 * §8H data-export job to write the assembled bundle. */
export async function putR2Object(env: R2Env, bucket: string, objectKey: string, body: string, contentType: string): Promise<void> {
  const { client } = getR2Client(env);
  const url = r2ObjectUrl(env, bucket, objectKey);
  const res = await r2FetchWithRetry(client, url, { method: "PUT", headers: { "content-type": contentType }, body });
  if (!res.ok) {
    throw new Error(`R2 put failed (${res.status}) for ${bucket}/${objectKey}`);
  }
}

/** Deletes one object outright — used by the retention purge jobs (§8H)
 * once a document's retention window has passed. A 404 (already gone) is
 * not an error here; the goal state either way is "the object is gone." */
export async function deleteR2Object(env: R2Env, bucket: string, objectKey: string): Promise<void> {
  const { client } = getR2Client(env);
  const url = r2ObjectUrl(env, bucket, objectKey);
  const res = await r2FetchWithRetry(client, url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed (${res.status}) for ${bucket}/${objectKey}`);
  }
}

export async function r2FetchWithRetry(
  client: AwsClient,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    const res = await client.fetch(url, init);
    if (res.status < 500 || init?.signal?.aborted) return res;
  } catch (error) {
    if (init?.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return client.fetch(url, init);
}
