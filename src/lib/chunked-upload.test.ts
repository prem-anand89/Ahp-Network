import { describe, expect, it, vi } from "vitest";
import {
  splitIntoChunks,
  uploadChunks,
  UploadCancelledError,
  type ChunkPart,
} from "./chunked-upload";

function makeFile(sizeBytes: number, name = "video.mp4"): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: "video/mp4" });
}

describe("splitIntoChunks", () => {
  it("splits a file into 5MB parts, last part smaller", () => {
    const file = makeFile(12 * 1024 * 1024); // 12MB → 5, 5, 2
    const parts = splitIntoChunks(file);
    expect(parts).toHaveLength(3);
    expect(parts[0].blob.size).toBe(5 * 1024 * 1024);
    expect(parts[1].blob.size).toBe(5 * 1024 * 1024);
    expect(parts[2].blob.size).toBe(2 * 1024 * 1024);
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  });

  it("a file smaller than one chunk produces a single part", () => {
    const parts = splitIntoChunks(makeFile(1024));
    expect(parts).toHaveLength(1);
  });
});

describe("uploadChunks", () => {
  it("uploads every part in order and reports progress", async () => {
    const parts = splitIntoChunks(makeFile(12 * 1024 * 1024));
    const uploadPart = vi.fn(async (part: ChunkPart) => `etag-${part.partNumber}`);
    const onProgress = vi.fn();

    const result = await uploadChunks(parts, uploadPart, { onProgress });

    expect(uploadPart).toHaveBeenCalledTimes(3);
    expect(result).toEqual([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
      { partNumber: 3, etag: "etag-3" },
    ]);
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  it("resumes from already-completed parts, skipping them", async () => {
    const parts = splitIntoChunks(makeFile(12 * 1024 * 1024));
    const uploadPart = vi.fn(async (part: ChunkPart) => `etag-${part.partNumber}`);

    const result = await uploadChunks(parts, uploadPart, {
      alreadyCompleted: [{ partNumber: 1, etag: "etag-1-from-before" }],
    });

    // Only parts 2 and 3 actually hit the network.
    expect(uploadPart).toHaveBeenCalledTimes(2);
    expect(uploadPart).not.toHaveBeenCalledWith(
      expect.objectContaining({ partNumber: 1 }),
      expect.anything(),
    );
    expect(result.find((p) => p.partNumber === 1)?.etag).toBe("etag-1-from-before");
  });

  it("stops immediately and throws if already aborted before starting", async () => {
    const parts = splitIntoChunks(makeFile(5 * 1024 * 1024));
    const uploadPart = vi.fn(async (part: ChunkPart) => `etag-${part.partNumber}`);
    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadChunks(parts, uploadPart, { signal: controller.signal }),
    ).rejects.toThrow(UploadCancelledError);
    expect(uploadPart).not.toHaveBeenCalled();
  });

  it("cancelling mid-upload stops before the remaining parts, but keeps completed ones (resumable)", async () => {
    const parts = splitIntoChunks(makeFile(15 * 1024 * 1024)); // 3 parts
    const controller = new AbortController();

    const uploadPart = vi.fn(async (part: ChunkPart) => {
      if (part.partNumber === 2) controller.abort(); // cancel after part 2 starts...
      return `etag-${part.partNumber}`;
    });

    await expect(
      uploadChunks(parts, uploadPart, { signal: controller.signal }),
    ).rejects.toThrow(UploadCancelledError);

    // Part 3 never attempted since the abort happened before its turn.
    expect(uploadPart).toHaveBeenCalledTimes(2);
  });
});
