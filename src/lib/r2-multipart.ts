// Real R2 multipart upload glue — the thin layer chunked-upload.ts's
// injectable `uploadPart` function calls in production. Not heavily unit
// tested itself (same reasoning as r2-presign.ts and compress-photo.ts's
// canvas path): it's a direct pass-through to R2's S3-compatible multipart
// API, where the actual value-at-risk logic (split/resume/cancel ordering)
// lives in chunked-upload.ts and is tested there against an injected fake.
//
// Hand-rolled against R2's multipart XML API (not the AWS SDK's command
// objects — see r2.ts for why) via aws4fetch, which signs the request and
// hands back a plain Response; parsing/building the XML bodies is done
// here explicitly.

import { getR2Client, r2ObjectUrl, CREDENTIALS_BUCKET, PHOTOS_BUCKET, type R2Env } from "./r2";
import type { UploadedPart } from "./chunked-upload";
import type { UploadKind } from "./upload-validation";

function bucketFor(kind: UploadKind): string {
  return kind === "photo" ? PHOTOS_BUCKET : CREDENTIALS_BUCKET;
}

async function throwIfNotOk(res: Response, action: string): Promise<void> {
  if (!res.ok) {
    throw new Error(`R2 ${action} failed: ${res.status} ${await res.text()}`);
  }
}

export async function startMultipartUpload(
  env: R2Env,
  kind: UploadKind,
  objectKey: string,
  contentType: string,
): Promise<string> {
  const { client } = getR2Client(env);
  const url = new URL(r2ObjectUrl(env, bucketFor(kind), objectKey));
  url.searchParams.set("uploads", "");

  const res = await client.fetch(url.toString(), {
    method: "POST",
    headers: { "content-type": contentType },
  });
  await throwIfNotOk(res, "multipart create");

  const xml = await res.text();
  const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  if (!uploadId) throw new Error("R2 did not return an UploadId");
  return uploadId;
}

export async function uploadPartToR2(
  env: R2Env,
  kind: UploadKind,
  objectKey: string,
  uploadId: string,
  partNumber: number,
  body: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const { client } = getR2Client(env);
  const url = new URL(r2ObjectUrl(env, bucketFor(kind), objectKey));
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);

  const res = await client.fetch(url.toString(), {
    method: "PUT",
    body: new Uint8Array(await body.arrayBuffer()),
    signal,
  });
  await throwIfNotOk(res, "part upload");

  const etag = res.headers.get("etag");
  if (!etag) throw new Error("R2 did not return an ETag for the part");
  return etag;
}

export async function completeMultipartUpload(
  env: R2Env,
  kind: UploadKind,
  objectKey: string,
  uploadId: string,
  parts: UploadedPart[],
): Promise<void> {
  const { client } = getR2Client(env);
  const url = new URL(r2ObjectUrl(env, bucketFor(kind), objectKey));
  url.searchParams.set("uploadId", uploadId);

  const body = `<CompleteMultipartUpload>${parts
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
    .join("")}</CompleteMultipartUpload>`;

  const res = await client.fetch(url.toString(), {
    method: "POST",
    body,
    headers: { "content-type": "application/xml" },
  });
  await throwIfNotOk(res, "multipart complete");
}

export async function abortMultipartUpload(
  env: R2Env,
  kind: UploadKind,
  objectKey: string,
  uploadId: string,
): Promise<void> {
  const { client } = getR2Client(env);
  const url = new URL(r2ObjectUrl(env, bucketFor(kind), objectKey));
  url.searchParams.set("uploadId", uploadId);

  const res = await client.fetch(url.toString(), { method: "DELETE" });
  await throwIfNotOk(res, "multipart abort");
}
