// Real R2 multipart upload glue — the thin layer chunked-upload.ts's
// injectable `uploadPart` function calls in production. Not heavily unit
// tested itself (same reasoning as r2-presign.ts and compress-photo.ts's
// canvas path): it's a direct pass-through to R2's S3-compatible API,
// where the actual value-at-risk logic (split/resume/cancel ordering)
// lives in chunked-upload.ts and is tested there against an injected fake.

import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getR2Client, CREDENTIALS_BUCKET, PHOTOS_BUCKET } from "./r2";
import type { UploadedPart } from "./chunked-upload";
import type { UploadKind } from "./upload-validation";

interface R2Env {
  CLOUDFLARE_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

function bucketFor(kind: UploadKind): string {
  return kind === "photo" ? PHOTOS_BUCKET : CREDENTIALS_BUCKET;
}

export async function startMultipartUpload(
  env: R2Env,
  kind: UploadKind,
  objectKey: string,
  contentType: string,
): Promise<string> {
  const client = getR2Client(env);
  const { UploadId } = await client.send(
    new CreateMultipartUploadCommand({ Bucket: bucketFor(kind), Key: objectKey, ContentType: contentType }),
  );
  if (!UploadId) throw new Error("R2 did not return an UploadId");
  return UploadId;
}

export async function uploadPartToR2(
  env: R2Env,
  kind: UploadKind,
  objectKey: string,
  uploadId: string,
  partNumber: number,
  body: Blob,
): Promise<string> {
  const client = getR2Client(env);
  const { ETag } = await client.send(
    new UploadPartCommand({
      Bucket: bucketFor(kind),
      Key: objectKey,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: new Uint8Array(await body.arrayBuffer()),
    }),
  );
  if (!ETag) throw new Error("R2 did not return an ETag for the part");
  return ETag;
}

export async function completeMultipartUpload(
  env: R2Env,
  kind: UploadKind,
  objectKey: string,
  uploadId: string,
  parts: UploadedPart[],
): Promise<void> {
  const client = getR2Client(env);
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucketFor(kind),
      Key: objectKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }),
  );
}

export async function abortMultipartUpload(
  env: R2Env,
  kind: UploadKind,
  objectKey: string,
  uploadId: string,
): Promise<void> {
  const client = getR2Client(env);
  await client.send(
    new AbortMultipartUploadCommand({ Bucket: bucketFor(kind), Key: objectKey, UploadId: uploadId }),
  );
}
