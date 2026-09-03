// The "chunked... cancellable/resumable upload" half of BUILD_SEQUENCE.md
// Phase 1's form primitive. Splits a file into fixed-size parts (R2's
// S3-compatible multipart upload API, min 5MB per part except the last) so
// a dropped connection loses at most one in-flight chunk, not the whole
// upload — and the same chunk list is what makes resuming possible: skip
// any part index already recorded as completed.
//
// The orchestration logic here (splitIntoChunks, uploadChunks) takes
// `uploadPart` as an injected function rather than calling R2/fetch
// directly, so cancellation and resume-from-partial-progress are testable
// without a real network — the same reasoning as compress-photo.ts's
// injectable compressor.

export const CHUNK_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — R2/S3 multipart minimum part size

export interface ChunkPart {
  partNumber: number; // 1-indexed, per the S3 multipart API
  blob: Blob;
}

export function splitIntoChunks(file: File, chunkSize = CHUNK_SIZE_BYTES): ChunkPart[] {
  const parts: ChunkPart[] = [];
  let offset = 0;
  let partNumber = 1;
  while (offset < file.size) {
    parts.push({ partNumber, blob: file.slice(offset, offset + chunkSize) });
    offset += chunkSize;
    partNumber += 1;
  }
  return parts;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export type UploadPartFn = (part: ChunkPart, signal: AbortSignal) => Promise<string>; // resolves to the part's ETag

export interface UploadChunksOptions {
  /** Part numbers already uploaded in a prior attempt — skipped, not re-uploaded. Enables resume. */
  alreadyCompleted?: UploadedPart[];
  onProgress?: (completedParts: number, totalParts: number) => void;
  signal?: AbortSignal;
}

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

export async function uploadChunks(
  parts: ChunkPart[],
  uploadPart: UploadPartFn,
  options: UploadChunksOptions = {},
): Promise<UploadedPart[]> {
  const { alreadyCompleted = [], onProgress, signal } = options;
  const completed = new Map(alreadyCompleted.map((p) => [p.partNumber, p]));

  onProgress?.(completed.size, parts.length);

  for (const part of parts) {
    if (signal?.aborted) throw new UploadCancelledError();
    if (completed.has(part.partNumber)) continue; // resume — already done

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);

    try {
      const etag = await uploadPart(part, controller.signal);
      completed.set(part.partNumber, { partNumber: part.partNumber, etag });
      onProgress?.(completed.size, parts.length);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  return [...completed.values()].sort((a, b) => a.partNumber - b.partNumber);
}
